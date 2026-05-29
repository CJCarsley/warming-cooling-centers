import { defineFunction } from '@aws-amplify/backend';

export const getPopupConfig = defineFunction({
  name: 'getPopupConfig',
  entry: './handler.ts',
  environment: {
    TABLE_NAME: 'FacilityOverrides',
  },
  timeoutSeconds: 10,
  runtime: 18,
});
