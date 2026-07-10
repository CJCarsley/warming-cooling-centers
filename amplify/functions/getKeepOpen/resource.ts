import { defineFunction } from '@aws-amplify/backend';

export const getKeepOpen = defineFunction({
  name: 'getKeepOpen',
  entry: './handler.ts',
  environment: {
    TABLE_NAME: 'FacilityOverrides',
  },
  timeoutSeconds: 10,
  runtime: 22,
});
