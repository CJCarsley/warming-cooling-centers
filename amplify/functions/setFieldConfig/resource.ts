import { defineFunction } from '@aws-amplify/backend';

export const setFieldConfig = defineFunction({
  name: 'setFieldConfig',
  entry: './handler.ts',
  environment: {
    TABLE_NAME: 'FacilityOverrides',
  },
  timeoutSeconds: 10,
  runtime: 18,
});
