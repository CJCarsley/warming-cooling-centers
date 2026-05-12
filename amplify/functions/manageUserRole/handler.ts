import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const USER_POOL_ID = process.env.USER_POOL_ID!;
const PROTECTED_EMAIL = 'cjcarsley@douglascounty-ne.gov';

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

interface RequestBody {
  targetUsername: string;
  action: 'add' | 'remove';
  group: string;
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

  const { targetUsername, action, group } = body;

  if (!targetUsername || !action || !group) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing fields' }),
    };
  }

  if (group !== 'Admin') {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Cannot manage that group' }),
    };
  }

  if (action !== 'add' && action !== 'remove') {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid action' }),
    };
  }

  if (action === 'remove') {
    try {
      const userRes = await cognito.send(
        new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: targetUsername }),
      );
      const targetEmail =
        userRes.UserAttributes?.find((a) => a.Name === 'email')?.Value ?? '';
      if (targetEmail === PROTECTED_EMAIL) {
        return {
          statusCode: 403,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Cannot remove Admin from this user' }),
        };
      }
    } catch (err) {
      console.error('AdminGetUser error:', err);
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Internal server error' }),
      };
    }
  }

  try {
    if (action === 'add') {
      await cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: targetUsername,
          GroupName: group,
        }),
      );
    } else {
      await cognito.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: targetUsername,
          GroupName: group,
        }),
      );
    }
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('manageUserRole error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
