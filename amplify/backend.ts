import { defineBackend } from '@aws-amplify/backend';
import {
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction as LambdaFunctionTarget } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { auth } from './auth/resource';
import { updateStatus } from './functions/updateStatus/resource';
import { getUsersAndFacilities } from './functions/getUsersAndFacilities/resource';
import { updateUserFacilities } from './functions/updateUserFacilities/resource';
import { getKeepOpen } from './functions/getKeepOpen/resource';
import { updateKeepOpen } from './functions/updateKeepOpen/resource';
import { autoResetFacilities } from './functions/autoResetFacilities/resource';

const backend = defineBackend({
  auth,
  updateStatus,
  getUsersAndFacilities,
  updateUserFacilities,
  getKeepOpen,
  updateKeepOpen,
  autoResetFacilities,
});

// Password policy via CDK override (not exposed in defineAuth API)
const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 12,
    requireLowercase: true,
    requireUppercase: true,
    requireNumbers: true,
    requireSymbols: true,
  },
};

const apiStack = backend.createStack('FacilityStatusApiStack');
const { userPool } = backend.auth.resources;
const { userPoolArn } = userPool;

// ── DynamoDB table for keep-open overrides ────────────────────────────────────
const overridesTable = new Table(apiStack, 'FacilityOverrides', {
  tableName: 'FacilityOverrides',
  partitionKey: { name: 'facilityId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.RETAIN,
});

// ── Lambda environment variables & IAM permissions ───────────────────────────
// Cast IFunction → Function to access addEnvironment / addToRolePolicy
const updateStatusFn = backend.updateStatus.resources.lambda as LambdaFunction;
const getUsersFn = backend.getUsersAndFacilities.resources.lambda as LambdaFunction;
const updateFacilitiesFn = backend.updateUserFacilities.resources.lambda as LambdaFunction;
const getKeepOpenFn = backend.getKeepOpen.resources.lambda as LambdaFunction;
const updateKeepOpenFn = backend.updateKeepOpen.resources.lambda as LambdaFunction;
const autoResetFn = backend.autoResetFacilities.resources.lambda as LambdaFunction;

updateStatusFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['ses:SendEmail'],
    resources: ['*'],
  }),
);

getUsersFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
updateFacilitiesFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
getKeepOpenFn.addEnvironment('TABLE_NAME', overridesTable.tableName);
updateKeepOpenFn.addEnvironment('TABLE_NAME', overridesTable.tableName);
autoResetFn.addEnvironment('TABLE_NAME', overridesTable.tableName);

getUsersFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['cognito-idp:ListUsers'],
    resources: [userPoolArn],
  }),
);

updateFacilitiesFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminUpdateUserAttributes',
    ],
    resources: [userPoolArn],
  }),
);

overridesTable.grantReadData(getKeepOpenFn);
overridesTable.grantWriteData(updateKeepOpenFn);
overridesTable.grantReadData(autoResetFn);

// ── API Gateway ───────────────────────────────────────────────────────────────
const authorizer = new CognitoUserPoolsAuthorizer(
  apiStack,
  'CognitoAuthorizer',
  { cognitoUserPools: [userPool] },
);

const api = new RestApi(apiStack, 'FacilityStatusApi', {
  restApiName: 'FacilityStatusApi',
  defaultCorsPreflightOptions: {
    // TODO: replace Cors.ALL_ORIGINS with your *.amplifyapp.com domain after first deploy
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: ['Authorization', 'Content-Type'],
  },
  deployOptions: {
    // Rate-limit: 10 requests/s sustained, burst up to 20
    throttlingRateLimit: 10,
    throttlingBurstLimit: 20,
  },
});

// POST /facilities/status — facility status toggle
// GET  /facilities/keep-open — fetch keep-open overrides for caller's facilities
// PATCH /facilities/keep-open — set or clear a keep-open override
const facilitiesResource = api.root.addResource('facilities');

facilitiesResource
  .addResource('status')
  .addMethod('POST', new LambdaIntegration(backend.updateStatus.resources.lambda), {
    authorizer,
  });

const keepOpenResource = facilitiesResource.addResource('keep-open');

keepOpenResource.addMethod(
  'GET',
  new LambdaIntegration(backend.getKeepOpen.resources.lambda),
  { authorizer },
);

keepOpenResource.addMethod(
  'PATCH',
  new LambdaIntegration(backend.updateKeepOpen.resources.lambda),
  { authorizer },
);

// GET /admin/users — list all users + live facility data
// PATCH /admin/users/facilities — add/remove a facility assignment
const usersResource = api.root.addResource('admin').addResource('users');

usersResource.addMethod(
  'GET',
  new LambdaIntegration(backend.getUsersAndFacilities.resources.lambda),
  { authorizer },
);

usersResource
  .addResource('facilities')
  .addMethod(
    'PATCH',
    new LambdaIntegration(backend.updateUserFacilities.resources.lambda),
    { authorizer },
  );

// ── EventBridge rule: nightly reset at midnight CT (06:00 UTC; ~1h DST drift accepted) ──
new Rule(apiStack, 'NightlyResetRule', {
  schedule: Schedule.cron({ minute: '0', hour: '6' }),
  targets: [new LambdaFunctionTarget(autoResetFn)],
});

// ── Add cjcarsley to SuperAdmin group (idempotent) ────────────────────────────
const addSuperAdminCall = {
  service: 'CognitoIdentityServiceProvider',
  action: 'adminAddUserToGroup',
  parameters: {
    UserPoolId: userPool.userPoolId,
    Username: 'cjcarsley@douglascounty-ne.gov',
    GroupName: 'SuperAdmin',
  },
  physicalResourceId: PhysicalResourceId.of('cjcarsley-superadmin-v1'),
  ignoreErrorCodesMatching: 'UserNotFoundException',
};

new AwsCustomResource(apiStack, 'AddSuperAdminUser', {
  onCreate: addSuperAdminCall,
  onUpdate: addSuperAdminCall,
  policy: AwsCustomResourcePolicy.fromStatements([
    new PolicyStatement({
      actions: ['cognito-idp:AdminAddUserToGroup'],
      resources: [userPoolArn],
    }),
  ]),
  installLatestAwsSdk: false,
});

backend.addOutput({
  custom: {
    API: {
      facilityStatusApiUrl: api.url,
    },
  },
});
