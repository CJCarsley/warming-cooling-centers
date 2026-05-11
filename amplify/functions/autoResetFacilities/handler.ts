import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME!;
const ARCGIS_CLIENT_ID = process.env.ARCGIS_CLIENT_ID!;
const ARCGIS_CLIENT_SECRET = process.env.ARCGIS_CLIENT_SECRET!;
const ARCGIS_FEATURE_LAYER_URL = process.env.ARCGIS_FEATURE_LAYER_URL!;
const ARCGIS_TOKEN_URL = 'https://www.arcgis.com/sharing/rest/oauth2/token';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ArcGISTokenResponse {
  access_token?: string;
  error?: { code: number; message: string };
}

interface ArcGISQueryResponse {
  features?: Array<{ attributes: { ObjectID: number } }>;
  error?: { code: number; message: string };
}

interface ArcGISApplyEditsResponse {
  updateResults?: Array<{ objectId: number; success: boolean }>;
  error?: { code: number; message: string };
}

async function getArcGISToken(): Promise<string> {
  const params = new URLSearchParams({
    client_id: ARCGIS_CLIENT_ID,
    client_secret: ARCGIS_CLIENT_SECRET,
    grant_type: 'client_credentials',
    f: 'json',
  });

  const res = await fetch(ARCGIS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = (await res.json()) as ArcGISTokenResponse;
  if (!data.access_token) {
    throw new Error(`ArcGIS token error: ${JSON.stringify(data.error)}`);
  }
  return data.access_token;
}

export const handler = async (): Promise<void> => {
  const token = await getArcGISToken();

  const queryParams = new URLSearchParams({
    where: "Warming_Active='Yes' OR Cooling_Active='Yes'",
    outFields: 'ObjectID',
    returnGeometry: 'false',
    f: 'json',
    token,
  });

  const queryRes = await fetch(
    `${ARCGIS_FEATURE_LAYER_URL}/query?${queryParams.toString()}`,
  );
  const queryData = (await queryRes.json()) as ArcGISQueryResponse;

  if (queryData.error) {
    console.error('ArcGIS query error:', queryData.error);
    return;
  }

  const activeFacilities = queryData.features ?? [];
  if (activeFacilities.length === 0) {
    console.log('No active facilities to reset');
    return;
  }

  // Check each facility for a keep-open override
  const toReset: number[] = [];
  for (const feature of activeFacilities) {
    const id = feature.attributes.ObjectID;
    try {
      const result = await ddb.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { facilityId: String(id) },
          ConsistentRead: true,
        }),
      );
      if (!result.Item) {
        toReset.push(id);
      } else {
        console.log(`Facility ${id} has keep-open override; skipping`);
      }
    } catch (err) {
      console.error(`DynamoDB GetItem failed for facility ${id}; skipping reset (fail-safe):`, err);
    }
  }

  if (toReset.length === 0) {
    console.log(
      `All ${activeFacilities.length} active facilities have keep-open overrides; skipping reset`,
    );
    return;
  }

  const updates = toReset.map((id) => ({
    attributes: { ObjectID: id, Warming_Active: 'No', Cooling_Active: 'No' },
  }));

  const applyParams = new URLSearchParams({
    updates: JSON.stringify(updates),
    f: 'json',
    token,
  });

  const applyRes = await fetch(`${ARCGIS_FEATURE_LAYER_URL}/applyEdits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: applyParams.toString(),
  });

  const applyData = (await applyRes.json()) as ArcGISApplyEditsResponse;

  if (applyData.error) {
    console.error('ArcGIS applyEdits error:', applyData.error);
    return;
  }

  const succeeded = (applyData.updateResults ?? []).filter((r) => r.success).length;
  console.log(`Auto-reset complete: ${succeeded}/${toReset.length} facilities deactivated`);
};
