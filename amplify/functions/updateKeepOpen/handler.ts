import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

interface UpdateKeepOpenBody {
  facilityId: number;
  keepOpen: boolean;
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const claims = event.requestContext.authorizer?.claims as
    | Record<string, string>
    | undefined;
  const facilityIdsStr = claims?.['custom:facility_ids'] ?? '';
  const allowedIds = facilityIdsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!event.body) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing request body' }),
    };
  }

  let body: UpdateKeepOpenBody;
  try {
    body = JSON.parse(event.body) as UpdateKeepOpenBody;
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const { facilityId, keepOpen } = body;

  if (typeof facilityId !== 'number' || typeof keepOpen !== 'boolean') {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid parameters' }),
    };
  }

  if (!allowedIds.includes(String(facilityId))) {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Not authorized for this facility' }),
    };
  }

  try {
    if (keepOpen) {
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { facilityId: String(facilityId) },
        }),
      );
    } else {
      await ddb.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { facilityId: String(facilityId) },
        }),
      );
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('updateKeepOpen error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
