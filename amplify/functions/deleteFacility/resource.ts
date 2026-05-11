import { defineFunction, secret } from '@aws-amplify/backend';

export const deleteFacility = defineFunction({
  name: 'deleteFacility',
  entry: './handler.ts',
  environment: {
    ARCGIS_CLIENT_ID: secret('ARCGIS_CLIENT_ID'),
    ARCGIS_CLIENT_SECRET: secret('ARCGIS_CLIENT_SECRET'),
    ARCGIS_FEATURE_LAYER_URL:
      'https://services.arcgis.com/pDAi2YK0L0QxVJHj/arcgis/rest/services/Warming_and_Cooling_Centers/FeatureServer/0',
    TABLE_NAME: 'FacilityOverrides',
  },
  timeoutSeconds: 30,
  runtime: 18,
});
