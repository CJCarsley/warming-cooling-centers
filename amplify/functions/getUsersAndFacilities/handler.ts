import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const USER_POOL_ID = process.env.USER_POOL_ID!;
const ARCGIS_FEATURE_LAYER_URL = process.env.ARCGIS_FEATURE_LAYER_URL!;

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

interface ArcGISFeature {
  attributes: {
    ObjectID: number;
    Name: string;
    Address: string;
    Warming_Active: string;
    Cooling_Active: string;
  };
}

interface ArcGISQueryResponse {
  features?: ArcGISFeature[];
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const claims = event.requestContext.authorizer?.claims as
    | Record<string, string>
    | undefined;
  const callerGroups = parseGroups(claims?.['cognito:groups']);

  if (!callerGroups.includes('SuperAdmin') && !callerGroups.includes('Admin')) {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  try {
    const [usersResult, adminGroupResult, superAdminGroupResult] = await Promise.all([
      cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 })),
      cognito.send(
        new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: 'Admin', Limit: 60 }),
      ),
      cognito.send(
        new ListUsersInGroupCommand({
          UserPoolId: USER_POOL_ID,
          GroupName: 'SuperAdmin',
          Limit: 60,
        }),
      ),
    ]);

    const adminUsernames = new Set(
      (adminGroupResult.Users ?? []).map((u) => u.Username ?? ''),
    );
    const superAdminUsernames = new Set(
      (superAdminGroupResult.Users ?? []).map((u) => u.Username ?? ''),
    );

    const users = (usersResult.Users ?? []).map((u) => {
      const username = u.Username ?? '';
      const userGroups: string[] = [];
      if (adminUsernames.has(username)) userGroups.push('Admin');
      if (superAdminUsernames.has(username)) userGroups.push('SuperAdmin');
      return {
        username,
        email: u.Attributes?.find((a) => a.Name === 'email')?.Value ?? '',
        status: u.UserStatus ?? 'UNKNOWN',
        enabled: u.Enabled ?? false,
        facilityIds:
          u.Attributes?.find((a) => a.Name === 'custom:facility_ids')?.Value ?? '',
        groups: userGroups,
      };
    });

    const params = new URLSearchParams({
      where: '1=1',
      outFields: 'ObjectID,Name,Address,Warming_Active,Cooling_Active',
      returnGeometry: 'false',
      f: 'json',
    });

    const arcRes = await fetch(
      `${ARCGIS_FEATURE_LAYER_URL}/query?${params.toString()}`,
    );
    const arcData = (await arcRes.json()) as ArcGISQueryResponse;

    const facilities = (arcData.features ?? []).map((f) => ({
      objectId: f.attributes.ObjectID,
      name: f.attributes.Name,
      address: f.attributes.Address,
      warmingActive: f.attributes.Warming_Active === 'Yes',
      coolingActive: f.attributes.Cooling_Active === 'Yes',
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ users, facilities }),
    };
  } catch (err) {
    console.error('getUsersAndFacilities error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
