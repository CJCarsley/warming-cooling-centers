import { defineFunction, secret } from '@aws-amplify/backend';

export const autoCloseByHours = defineFunction({
  name: 'autoCloseByHours',
  entry: './handler.ts',
  environment: {
    TABLE_NAME: 'FacilityOverrides',
    ARCGIS_CLIENT_ID: secret('ARCGIS_CLIENT_ID'),
    ARCGIS_CLIENT_SECRET: secret('ARCGIS_CLIENT_SECRET'),
    ARCGIS_FEATURE_LAYER_URL:
      'https://services.arcgis.com/pDAi2YK0L0QxVJHj/arcgis/rest/services/Warming_and_Cooling_Centers/FeatureServer/0',
  },
  timeoutSeconds: 60,
  runtime: 18,
});
