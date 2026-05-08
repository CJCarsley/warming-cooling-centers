import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getArcGISToken } from '../shared/arcgisToken';

const USER_POOL_ID = process.env.USER_POOL_ID!;
const ARCGIS_FEATURE_LAYER_URL = process.env.ARCGIS_FEATURE_LAYER_URL!;

const cognito = new CognitoIdentityProviderClient({});

interface AddFacilityBody {
  geometry: { x: number; y: number; spatialReference: { wkid: number } };
  attributes: Record<string, string | number | boolean | null>;
}

interface ArcGISApplyEditsResponse {
  addResults?: Array<{
    objectId: number;
    success: boolean;
    error?: { code: number; description: string };
  }>;
  error?: { code: number; message: string };
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const claims = event.requestContext.authorizer?.claims as Record<string, string> | undefined;
  const username = claims?.['cognito:username'];

  if (!username) {
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!event.body) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing request body' }) };
  }

  let body: AddFacilityBody;
  try {
    body = JSON.parse(event.body) as AddFacilityBody;
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { geometry, attributes } = body;
  if (!geometry || typeof geometry.x !== 'number' || typeof geometry.y !== 'number') {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid geometry' }) };
  }

  try {
    const token = await getArcGISToken();

    const adds = JSON.stringify([{ geometry, attributes }]);
    const applyRes = await fetch(`${ARCGIS_FEATURE_LAYER_URL}/applyEdits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ adds, f: 'json', token }).toString(),
    });

    const result = (await applyRes.json()) as ArcGISApplyEditsResponse;

    if (result.error) {
      console.error('ArcGIS applyEdits error:', result.error);
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Feature layer error' }) };
    }

    const addResult = result.addResults?.[0];
    if (!addResult?.success) {
      console.error('ArcGIS add rejected:', addResult);
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Feature layer rejected the add' }) };
    }

    const newObjectId = addResult.objectId;

    // Append new ObjectID to the user's facility_ids attribute
    const userRes = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    const currentIds = userRes.UserAttributes?.find((a) => a.Name === 'custom:facility_ids')?.Value ?? '';
    const idList = currentIds.split(',').map((s) => s.trim()).filter(Boolean);
    if (!idList.includes(String(newObjectId))) idList.push(String(newObjectId));

    await cognito.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      UserAttributes: [{ Name: 'custom:facility_ids', Value: idList.join(',') }],
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, newObjectId }),
    };
  } catch (err) {
    console.error('addFacility error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
