import { defineFunction } from '@aws-amplify/backend';

export const updateKeepOpen = defineFunction({
  name: 'updateKeepOpen',
  entry: './handler.ts',
  environment: {
    TABLE_NAME: 'FacilityOverrides',
  },
  timeoutSeconds: 10,
  runtime: 22,
});
