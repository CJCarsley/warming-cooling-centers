import { defineFunction } from '@aws-amplify/backend';

export const postConfirmation = defineFunction({
  name: 'postConfirmation',
  entry: './handler.ts',
  timeoutSeconds: 10,
  runtime: 18,
  // Place this function in the auth nested stack so the Cognito-trigger
  // wiring (CfnPermission with sourceArn=userPoolArn + LambdaConfig with
  // function ARN) is intra-stack and can't form a cross-stack cycle.
  resourceGroupName: 'auth',
});
