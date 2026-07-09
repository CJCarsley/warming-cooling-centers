import { defineFunction } from '@aws-amplify/backend';

export const setPopupConfig = defineFunction({
  name: 'setPopupConfig',
  entry: './handler.ts',
  environment: {
    TABLE_NAME: 'FacilityOverrides',
  },
  timeoutSeconds: 10,
  runtime: 22,
});
