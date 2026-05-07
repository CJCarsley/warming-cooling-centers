import { defineFunction } from '@aws-amplify/backend';

export const updateKeepOpen = defineFunction({
  name: 'updateKeepOpen',
  entry: './handler.ts',
  timeoutSeconds: 10,
  runtime: 18,
});
