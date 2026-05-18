import { defineFunction } from '@aws-amplify/backend';

export const deleteUser = defineFunction({
  name: 'deleteUser',
  entry: './handler.ts',
  timeoutSeconds: 15,
  runtime: 18,
});
