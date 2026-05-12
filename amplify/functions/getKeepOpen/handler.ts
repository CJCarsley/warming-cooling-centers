import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const claims = event.requestContext.authorizer?.claims as
    | Record<string, string>
    | undefined;
  const facilityIdsStr = claims?.['custom:facility_ids'] ?? '';
  const ids = facilityIdsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ keepOpenIds: [] }),
    };
  }

  try {
    const result = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [TABLE_NAME]: { Keys: ids.map((id) => ({ facilityId: id })) },
        },
      }),
    );

    const found = (result.Responses?.[TABLE_NAME] ?? [])
      .filter((item) => item.keepOpen === true)
      .map((item) => Number(item.facilityId));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ keepOpenIds: found }),
    };
  } catch (err) {
    console.error('getKeepOpen error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
