import { defineFunction } from '@aws-amplify/backend';

export const getKeepOpen = defineFunction({
  name: 'getKeepOpen',
  entry: './handler.ts',
  timeoutSeconds: 10,
  runtime: 18,
});
