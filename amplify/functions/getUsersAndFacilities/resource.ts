import { defineFunction } from '@aws-amplify/backend';

export const getUsersAndFacilities = defineFunction({
  name: 'getUsersAndFacilities',
  entry: './handler.ts',
  environment: {
    ARCGIS_FEATURE_LAYER_URL:
      'https://services.arcgis.com/pDAi2YK0L0QxVJHj/arcgis/rest/services/Warming_and_Cooling_Centers/FeatureServer/0',
  },
  timeoutSeconds: 30,
  runtime: 18,
});
