import type { APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME!;
// Reserved PK in the FacilityOverrides table — coexists with numeric facilityId rows.
// Scans in autoReset/autoClose filter on keepOpen, so this item never matches them.
const CONFIG_KEY = '__popup_config__';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Public read (no Cognito authorizer): the public map pop-up reads this layout.
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

export const handler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const result = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { facilityId: CONFIG_KEY } }),
    );
    const raw = result.Item?.popupConfig;
    const sections = Array.isArray(raw) ? raw : [];
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ sections }),
    };
  } catch (err) {
    console.error('getPopupConfig error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
