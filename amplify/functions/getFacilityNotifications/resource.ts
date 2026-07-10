import { defineFunction } from '@aws-amplify/backend';

export const getFacilityNotifications = defineFunction({
  name: 'getFacilityNotifications',
  entry: './handler.ts',
  environment: {
    TABLE_NAME: 'FacilityOverrides',
  },
  timeoutSeconds: 10,
  runtime: 22,
});
