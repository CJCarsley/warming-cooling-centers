import type { APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME!;
// Reserved PK in the FacilityOverrides table — coexists with numeric facilityId rows.
// Scans in autoReset/autoClose filter on keepOpen, so this item never matches them.
const CONFIG_KEY = '__field_config__';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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
    const raw = result.Item?.fieldConfig;
    const fields = Array.isArray(raw) ? (raw as string[]) : [];
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ fields }),
    };
  } catch (err) {
    console.error('getFieldConfig error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
