import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME!;
const CONFIG_KEY = '__popup_config__';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

function parseGroups(claimValue: string | undefined): string[] {
  if (!claimValue) return [];
  try {
    const parsed = JSON.parse(claimValue) as unknown;
    if (Array.isArray(parsed)) return parsed as string[];
    if (typeof parsed === 'string') return [parsed];
    return [];
  } catch {
    return claimValue.split(',').map((s) => s.trim()).filter(Boolean);
  }
}

interface PopupSection {
  id: string;
  title: string;
  fields: string[];
}

interface RequestBody {
  sections: PopupSection[];
}

function isValidSections(value: unknown): value is PopupSection[] {
  return (
    Array.isArray(value) &&
    value.every(
      (s) =>
        s != null &&
        typeof (s as PopupSection).id === 'string' &&
        typeof (s as PopupSection).title === 'string' &&
        Array.isArray((s as PopupSection).fields) &&
        (s as PopupSection).fields.every((f) => typeof f === 'string'),
    )
  );
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const claims = event.requestContext.authorizer?.claims as
    | Record<string, string>
    | undefined;
  const groups = parseGroups(claims?.['cognito:groups']);

  // Both admin tiers may edit the public pop-up layout.
  if (!groups.includes('SuperAdmin') && !groups.includes('Admin')) {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing request body' }),
    };
  }

  let body: RequestBody;
  try {
    body = JSON.parse(event.body) as RequestBody;
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const { sections } = body;
  if (!isValidSections(sections)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid parameters' }),
    };
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { facilityId: CONFIG_KEY },
        UpdateExpression: 'SET popupConfig = :s, popupConfigUpdatedAt = :now',
        ExpressionAttributeValues: { ':s': sections, ':now': Date.now() },
      }),
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, sections }),
    };
  } catch (err) {
    console.error('setPopupConfig error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
