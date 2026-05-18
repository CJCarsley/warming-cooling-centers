import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const USER_POOL_ID = process.env.USER_POOL_ID!;
const PROTECTED_EMAIL = 'cjcarsley@douglascounty-ne.gov';

const cognito = new CognitoIdentityProviderClient({});

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

interface RequestBody {
  targetUsername: string;
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const claims = event.requestContext.authorizer?.claims as
    | Record<string, string>
    | undefined;
  const callerEmail = claims?.email ?? '';

  if (callerEmail !== PROTECTED_EMAIL) {
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

  const { targetUsername } = body;
  if (!targetUsername) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing targetUsername' }),
    };
  }

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
        body: JSON.stringify({ error: 'Cannot delete the protected user' }),
      };
    }

    const groupsRes = await cognito.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: targetUsername,
      }),
    );
    const targetGroups = (groupsRes.Groups ?? []).map((g) => g.GroupName ?? '');
    if (targetGroups.includes('SuperAdmin')) {
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Cannot delete a SuperAdmin' }),
      };
    }
  } catch (err) {
    console.error('deleteUser pre-check error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }

  try {
    await cognito.send(
      new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: targetUsername,
      }),
    );
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('deleteUser error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
