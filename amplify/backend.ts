import { defineBackend } from '@aws-amplify/backend';
import {
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { auth } from './auth/resource';
import { updateStatus } from './functions/updateStatus/resource';
import { getUsersAndFacilities } from './functions/getUsersAndFacilities/resource';
import { updateUserFacilities } from './functions/updateUserFacilities/resource';

const backend = defineBackend({
  auth,
  updateStatus,
  getUsersAndFacilities,
  updateUserFacilities,
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

// ── Lambda environment variables & IAM permissions ───────────────────────────
// Cast IFunction → Function to access addEnvironment / addToRolePolicy
const getUsersFn = backend.getUsersAndFacilities.resources.lambda as LambdaFunction;
const updateFacilitiesFn = backend.updateUserFacilities.resources.lambda as LambdaFunction;

getUsersFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
updateFacilitiesFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);

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

// POST /facilities/status — facility status toggle (existing)
api.root
  .addResource('facilities')
  .addResource('status')
  .addMethod('POST', new LambdaIntegration(backend.updateStatus.resources.lambda), {
    authorizer,
  });

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

// ── Add cjcarsley to SuperAdmin group (idempotent) ────────────────────────────
// Ignores UserNotFoundException in case the user hasn't registered yet —
// re-run `amplify sandbox` or `amplify deploy` after the account is created.
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
