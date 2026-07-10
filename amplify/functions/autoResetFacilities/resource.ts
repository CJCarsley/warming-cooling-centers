import { defineFunction, secret } from '@aws-amplify/backend';

export const autoResetFacilities = defineFunction({
  name: 'autoResetFacilities',
  entry: './handler.ts',
  environment: {
    TABLE_NAME: 'FacilityOverrides',
    ARCGIS_CLIENT_ID: secret('ARCGIS_CLIENT_ID'),
    ARCGIS_CLIENT_SECRET: secret('ARCGIS_CLIENT_SECRET'),
    ARCGIS_FEATURE_LAYER_URL:
      'https://services.arcgis.com/pDAi2YK0L0QxVJHj/arcgis/rest/services/Warming_and_Cooling_Centers/FeatureServer/0',
    SES_FROM_EMAIL: 'do-not-reply@dcgis.org',
    SES_REGION: 'us-east-1',
    APP_URL: 'https://master.d2ru7u72364jx5.amplifyapp.com/admin',
  },
  timeoutSeconds: 60,
  runtime: 22,
});
