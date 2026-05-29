import { defineFunction } from '@aws-amplify/backend';

export const getFieldConfig = defineFunction({
  name: 'getFieldConfig',
  entry: './handler.ts',
  environment: {
    TABLE_NAME: 'FacilityOverrides',
  },
  timeoutSeconds: 10,
  runtime: 18,
});
