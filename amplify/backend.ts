import { defineBackend } from '@aws-amplify/backend';
import {
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { IRule, IRuleTarget, Rule, RuleTargetConfig, Schedule } from 'aws-cdk-lib/aws-events';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CfnPermission, Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { Stack } from 'aws-cdk-lib';
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
import { addFacility } from './functions/addFacility/resource';
import { updateFacilityAttributes } from './functions/updateFacilityAttributes/resource';
import { getFacilityNotifications } from './functions/getFacilityNotifications/resource';
import { setFacilityNotifications } from './functions/setFacilityNotifications/resource';
import { deleteFacility } from './functions/deleteFacility/resource';
import { manageUserRole } from './functions/manageUserRole/resource';
import { getArcGISPublicToken } from './functions/getArcGISPublicToken/resource';

const backend = defineBackend({
  auth,
  updateStatus,
  getUsersAndFacilities,
  updateUserFacilities,
  getKeepOpen,
  updateKeepOpen,
  autoResetFacilities,
  addFacility,
  updateFacilityAttributes,
  getFacilityNotifications,
  setFacilityNotifications,
  deleteFacility,
  manageUserRole,
  getArcGISPublicToken,
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
// Note: the FacilityOverrides DynamoDB table is managed outside CDK (pre-created,
// persists via RETAIN policy from feature/auto-reset branch initial deploy).
// Lambdas reference it by the hardcoded name 'FacilityOverrides' in resource.ts.
// Cast IFunction → Function to access addEnvironment / addToRolePolicy
const updateStatusFn = backend.updateStatus.resources.lambda as LambdaFunction;
const getUsersFn = backend.getUsersAndFacilities.resources.lambda as LambdaFunction;
const updateFacilitiesFn = backend.updateUserFacilities.resources.lambda as LambdaFunction;
const getKeepOpenFn = backend.getKeepOpen.resources.lambda as LambdaFunction;
const updateKeepOpenFn = backend.updateKeepOpen.resources.lambda as LambdaFunction;
const autoResetFn = backend.autoResetFacilities.resources.lambda as LambdaFunction;
const addFacilityFn = backend.addFacility.resources.lambda as LambdaFunction;
const updateFacilityAttrsFn = backend.updateFacilityAttributes.resources.lambda as LambdaFunction;
const getFacilityNotificationsFn = backend.getFacilityNotifications.resources.lambda as LambdaFunction;
const setFacilityNotificationsFn = backend.setFacilityNotifications.resources.lambda as LambdaFunction;
const deleteFacilityFn = backend.deleteFacility.resources.lambda as LambdaFunction;
const manageUserRoleFn = backend.manageUserRole.resources.lambda as LambdaFunction;

updateStatusFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['ses:SendEmail'],
    resources: ['*'],
  }),
);

getUsersFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
updateFacilitiesFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
addFacilityFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
deleteFacilityFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
manageUserRoleFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);

getUsersFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['cognito-idp:ListUsers', 'cognito-idp:ListUsersInGroup'],
    resources: [userPoolArn],
  }),
);

manageUserRoleFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminRemoveUserFromGroup',
    ],
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

addFacilityFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminUpdateUserAttributes',
    ],
    resources: [userPoolArn],
  }),
);

deleteFacilityFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminUpdateUserAttributes',
    ],
    resources: [userPoolArn],
  }),
);

// Grant DynamoDB access by constructing the ARN within each Lambda's own nested stack
// (using pseudo-params only — no cross-stack CFN Export/Import). TABLE_NAME is already
// hardcoded in each function's resource.ts so nothing flows from this stack to theirs.
const TABLE_LITERAL = 'FacilityOverrides';

for (const [fn, actions] of [
  [getKeepOpenFn, ['dynamodb:BatchGetItem', 'dynamodb:GetItem']],
  [updateKeepOpenFn, ['dynamodb:UpdateItem']],
  [autoResetFn, ['dynamodb:Scan']],
  [updateStatusFn, ['dynamodb:GetItem']],
  [getFacilityNotificationsFn, ['dynamodb:GetItem']],
  [setFacilityNotificationsFn, ['dynamodb:UpdateItem']],
  [addFacilityFn, ['dynamodb:UpdateItem']],
  [deleteFacilityFn, ['dynamodb:DeleteItem']],
] as [LambdaFunction, string[]][]) {
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions,
      resources: [
        // Stack.of(fn) is the Lambda's own nested stack — region/account are
        // CFN pseudo-params (AWS::Region / AWS::AccountId), not cross-stack refs.
        Stack.of(fn).formatArn({
          service: 'dynamodb',
          resource: 'table',
          resourceName: TABLE_LITERAL,
        }),
      ],
    }),
  );
}

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

// GET /arcgis-token — public endpoint (no Cognito auth); returns a short-lived
// ArcGIS token so the browser can access a privately-shared feature layer.
// The client caches this token and refreshes it before expiry.
api.root
  .addResource('arcgis-token')
  .addMethod('GET', new LambdaIntegration(backend.getArcGISPublicToken.resources.lambda));

const notificationsResource = facilitiesResource.addResource('notifications');
notificationsResource.addMethod(
  'GET',
  new LambdaIntegration(backend.getFacilityNotifications.resources.lambda),
  { authorizer },
);
notificationsResource.addMethod(
  'PATCH',
  new LambdaIntegration(backend.setFacilityNotifications.resources.lambda),
  { authorizer },
);

// POST /facility/add — add a new facility to the feature layer
// POST /facility/update-attributes — update attributes of an existing facility
const facilityResource = api.root.addResource('facility');

facilityResource
  .addResource('add')
  .addMethod('POST', new LambdaIntegration(backend.addFacility.resources.lambda), { authorizer });

facilityResource
  .addResource('update-attributes')
  .addMethod('POST', new LambdaIntegration(backend.updateFacilityAttributes.resources.lambda), { authorizer });

facilityResource
  .addResource('delete')
  .addMethod('POST', new LambdaIntegration(backend.deleteFacility.resources.lambda), { authorizer });

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

usersResource
  .addResource('role')
  .addMethod(
    'POST',
    new LambdaIntegration(backend.manageUserRole.resources.lambda),
    { authorizer },
  );

// ── EventBridge rule: nightly reset at midnight CT (06:00 UTC; ~1h DST drift accepted) ──
//
// LambdaFunctionTarget adds a CfnPermission to the Lambda's nested stack with sourceArn
// pointing back to this API stack — that creates a bidirectional cross-stack reference
// (cycle). Instead:
//   1. Create the CfnPermission HERE in apiStack (one-directional: apiStack → Lambda stack)
//   2. Use a plain IRuleTarget that returns the Lambda ARN without calling addPermission
new CfnPermission(apiStack, 'AutoResetInvokePermission', {
  action: 'lambda:InvokeFunction',
  functionName: autoResetFn.functionArn,
  principal: 'events.amazonaws.com',
});

const autoResetTarget: IRuleTarget = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  bind: (_rule: IRule, _id?: string): RuleTargetConfig => ({
    arn: autoResetFn.functionArn,
  }),
};

new Rule(apiStack, 'NightlyResetRule', {
  schedule: Schedule.cron({ minute: '0', hour: '6' }),
  targets: [autoResetTarget],
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
