import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const USER_POOL_ID = process.env.USER_POOL_ID!;

const cognito = new CognitoIdentityProviderClient({});

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

interface UpdateBody {
  targetUsername: string;
  objectId: number;
  action: 'add' | 'remove';
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const claims = event.requestContext.authorizer?.claims as
    | Record<string, string>
    | undefined;
  const groups = parseGroups(claims?.['cognito:groups']);

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
      body: JSON.stringify({ error: 'Missing body' }),
    };
  }

  let body: UpdateBody;
  try {
    body = JSON.parse(event.body) as UpdateBody;
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const { targetUsername, action } = body;
  const objectId = Number(body.objectId); // coerce string or number

  console.log('updateUserFacilities payload:', { targetUsername, objectId, action });

  if (
    typeof targetUsername !== 'string' ||
    !targetUsername ||
    !Number.isFinite(objectId) ||
    !['add', 'remove'].includes(action)
  ) {
    console.error('Validation failed:', { targetUsername, objectId, action });
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Invalid parameters',
        detail: { targetUsername: typeof targetUsername, objectId, action },
      }),
    };
  }

  try {
    const userResult = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: targetUsername }),
    );

    const currentIds =
      userResult.UserAttributes?.find((a) => a.Name === 'custom:facility_ids')
        ?.Value ?? '';

    const idList = currentIds.split(',').map((s) => s.trim()).filter(Boolean);
    const idStr = String(objectId);

    const updatedList =
      action === 'add'
        ? idList.includes(idStr)
          ? idList
          : [...idList, idStr]
        : idList.filter((id) => id !== idStr);

    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: targetUsername,
        UserAttributes: [
          { Name: 'custom:facility_ids', Value: updatedList.join(',') },
        ],
      }),
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ facilityIds: updatedList.join(',') }),
    };
  } catch (err) {
    console.error('updateUserFacilities error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
