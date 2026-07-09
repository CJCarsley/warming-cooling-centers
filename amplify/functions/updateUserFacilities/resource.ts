import { defineFunction } from '@aws-amplify/backend';

export const updateUserFacilities = defineFunction({
  name: 'updateUserFacilities',
  entry: './handler.ts',
  timeoutSeconds: 15,
  runtime: 22,
});
