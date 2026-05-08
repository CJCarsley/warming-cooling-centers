import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getArcGISToken } from '../shared/arcgisToken';

const ARCGIS_FEATURE_LAYER_URL = process.env.ARCGIS_FEATURE_LAYER_URL!;

interface UpdateAttributesBody {
  objectId: number;
  attributes: Record<string, string | number | boolean | null>;
}

interface ArcGISApplyEditsResponse {
  updateResults?: Array<{
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
  const allowedIds = facilityIdsStr.split(',').map((s) => s.trim()).filter(Boolean);

  if (!event.body) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing request body' }) };
  }

  let body: UpdateAttributesBody;
  try {
    body = JSON.parse(event.body) as UpdateAttributesBody;
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { objectId, attributes } = body;

  if (typeof objectId !== 'number' || !attributes || typeof attributes !== 'object') {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid parameters' }) };
  }

  if (!allowedIds.includes(String(objectId))) {
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Not authorized for this facility' }) };
  }

  try {
    const token = await getArcGISToken();

    const updates = JSON.stringify([{ attributes: { OBJECTID: objectId, ...attributes } }]);
    const applyRes = await fetch(`${ARCGIS_FEATURE_LAYER_URL}/applyEdits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ updates, f: 'json', token }).toString(),
    });

    const result = (await applyRes.json()) as ArcGISApplyEditsResponse;

    if (result.error) {
      console.error('ArcGIS applyEdits error:', result.error);
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Feature layer error' }) };
    }

    const updateResult = result.updateResults?.[0];
    if (!updateResult?.success) {
      console.error('ArcGIS update rejected:', updateResult);
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Feature layer rejected the update' }) };
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('updateFacilityAttributes error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
