import { defineFunction, secret } from '@aws-amplify/backend';

export const getArcGISPublicToken = defineFunction({
  name: 'getArcGISPublicToken',
  entry: './handler.ts',
  environment: {
    ARCGIS_CLIENT_ID: secret('ARCGIS_CLIENT_ID'),
    ARCGIS_CLIENT_SECRET: secret('ARCGIS_CLIENT_SECRET'),
  },
  timeoutSeconds: 15,
  runtime: 18,
});
