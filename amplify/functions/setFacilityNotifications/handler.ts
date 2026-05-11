import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

interface SetNotificationsBody {
  facilityId: number;
  emails: string;
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

  let body: SetNotificationsBody;
  try {
    body = JSON.parse(event.body) as SetNotificationsBody;
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const { facilityId, emails } = body;
  if (typeof facilityId !== 'number' || typeof emails !== 'string') {
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

  const trimmedEmails = emails.trim();

  try {
    if (trimmedEmails) {
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { facilityId: String(facilityId) },
          UpdateExpression: 'SET notificationEmails = :emails',
          ExpressionAttributeValues: { ':emails': trimmedEmails },
        }),
      );
    } else {
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { facilityId: String(facilityId) },
          UpdateExpression: 'REMOVE notificationEmails',
        }),
      );
    }
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('setFacilityNotifications error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
