import { defineFunction } from '@aws-amplify/backend';

export const manageUserRole = defineFunction({
  name: 'manageUserRole',
  entry: './handler.ts',
  timeoutSeconds: 15,
  runtime: 22,
});
