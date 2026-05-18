import { defineFunction } from '@aws-amplify/backend';

export const postConfirmation = defineFunction({
  name: 'postConfirmation',
  entry: './handler.ts',
  timeoutSeconds: 10,
  runtime: 18,
});
