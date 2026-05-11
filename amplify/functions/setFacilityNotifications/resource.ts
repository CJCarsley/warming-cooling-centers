import { defineFunction } from '@aws-amplify/backend';

export const setFacilityNotifications = defineFunction({
  name: 'setFacilityNotifications',
  entry: './handler.ts',
  environment: {
    TABLE_NAME: 'FacilityOverrides',
  },
  timeoutSeconds: 10,
  runtime: 18,
});
