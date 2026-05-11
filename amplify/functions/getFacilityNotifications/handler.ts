import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

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
  const allowedIds = facilityIdsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const facilityId = event.queryStringParameters?.facilityId;
  if (!facilityId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing facilityId' }),
    };
  }

  if (!allowedIds.includes(facilityId)) {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Not authorized for this facility' }),
    };
  }

  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { facilityId },
        ConsistentRead: true,
      }),
    );
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        notificationEmails: (result.Item?.notificationEmails as string | undefined) ?? '',
      }),
    };
  } catch (err) {
    console.error('getFacilityNotifications error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
