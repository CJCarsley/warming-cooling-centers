import { defineFunction } from '@aws-amplify/backend';

export const requestAccess = defineFunction({
  name: 'requestAccess',
  entry: './handler.ts',
  environment: {
    SES_FROM_EMAIL: 'do-not-reply@dcgis.org',
    SES_REGION: 'us-east-1',
    APP_URL: 'https://master.d2ru7u72364jx5.amplifyapp.com',
  },
  timeoutSeconds: 15,
  runtime: 18,
});
