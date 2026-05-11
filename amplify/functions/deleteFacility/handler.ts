import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { getArcGISToken } from '../shared/arcgisToken';

const USER_POOL_ID = process.env.USER_POOL_ID!;
const ARCGIS_FEATURE_LAYER_URL = process.env.ARCGIS_FEATURE_LAYER_URL!;
const TABLE_NAME = process.env.TABLE_NAME!;

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface DeleteFacilityBody {
  objectId: number;
}

interface ArcGISApplyEditsResponse {
  deleteResults?: Array<{
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
  const facilityIdsStr = claims?.['custom:facility_ids'] ?? '';
  const username = claims?.['cognito:username'];
  const allowedIds = facilityIdsStr.split(',').map((s) => s.trim()).filter(Boolean);

  if (!username) {
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!event.body) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing request body' }) };
  }

  let body: DeleteFacilityBody;
  try {
    body = JSON.parse(event.body) as DeleteFacilityBody;
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { objectId } = body;
  if (typeof objectId !== 'number') {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid objectId' }) };
  }

  if (!allowedIds.includes(String(objectId))) {
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Not authorized for this facility' }) };
  }

  try {
    const token = await getArcGISToken();

    const applyRes = await fetch(`${ARCGIS_FEATURE_LAYER_URL}/applyEdits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ deletes: String(objectId), f: 'json', token }).toString(),
    });

    const result = (await applyRes.json()) as ArcGISApplyEditsResponse;
    if (result.error) {
      console.error('ArcGIS applyEdits error:', result.error);
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Feature layer error' }) };
    }

    const deleteResult = result.deleteResults?.[0];
    if (!deleteResult?.success) {
      console.error('ArcGIS delete rejected:', deleteResult);
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Feature layer rejected the delete' }) };
    }

    // Remove facility from user's Cognito facility_ids (non-fatal if it fails)
    try {
      const userRes = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
      const currentIds = userRes.UserAttributes?.find((a) => a.Name === 'custom:facility_ids')?.Value ?? '';
      const updatedIds = currentIds
        .split(',')
        .map((s) => s.trim())
        .filter((id) => id && id !== String(objectId));
      await cognito.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributes: [{ Name: 'custom:facility_ids', Value: updatedIds.join(',') }],
      }));
    } catch (cognitoErr) {
      console.error('Cognito update failed (non-fatal):', cognitoErr);
    }

    // Clean up DynamoDB override record (non-fatal)
    try {
      await ddb.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { facilityId: String(objectId) },
      }));
    } catch (ddbErr) {
      console.error('DynamoDB cleanup failed (non-fatal):', ddbErr);
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('deleteFacility error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
