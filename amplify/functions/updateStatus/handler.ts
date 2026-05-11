import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const TABLE_NAME = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ARCGIS_CLIENT_ID = process.env.ARCGIS_CLIENT_ID!;
const ARCGIS_CLIENT_SECRET = process.env.ARCGIS_CLIENT_SECRET!;
const ARCGIS_FEATURE_LAYER_URL = process.env.ARCGIS_FEATURE_LAYER_URL!;
const ARCGIS_TOKEN_URL = 'https://www.arcgis.com/sharing/rest/oauth2/token';
const NOTIFICATION_EMAILS = process.env.NOTIFICATION_EMAILS ?? '';
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL!;
const SES_REGION = process.env.SES_REGION ?? 'us-west-2';

const ses = new SESClient({ region: SES_REGION });

interface UpdateStatusBody {
  featureId: number;
  field: 'Warming_Active' | 'Cooling_Active';
  value: boolean;
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

interface ArcGISTokenResponse {
  access_token?: string;
  error?: { code: number; message: string };
}

interface ArcGISQueryResponse {
  features?: Array<{ attributes: { Name?: string } }>;
}

async function getFacilityName(token: string, objectId: number): Promise<string> {
  const params = new URLSearchParams({
    objectIds: String(objectId),
    outFields: 'Name',
    f: 'json',
    token,
  });
  try {
    const res = await fetch(`${ARCGIS_FEATURE_LAYER_URL}/query?${params}`);
    const data = (await res.json()) as ArcGISQueryResponse;
    return data.features?.[0]?.attributes?.Name ?? `Facility #${objectId}`;
  } catch {
    return `Facility #${objectId}`;
  }
}

async function sendActivationEmail(
  facilityName: string,
  field: 'Warming_Active' | 'Cooling_Active',
  toAddresses: string[],
): Promise<void> {
  if (!toAddresses.length || !SES_FROM_EMAIL) return;

  const type = field === 'Warming_Active' ? 'warming' : 'cooling';
  const subject = `${facilityName} activated as a ${type} center`;
  const body = `${facilityName} has been activated as a ${type} center.\n\nThis is an automated notification from the Douglas County Warming & Cooling Centers system.`;
  const html = `<p><strong>${facilityName}</strong> has been activated as a <strong>${type} center</strong>.</p><p>This is an automated notification from the Douglas County Warming &amp; Cooling Centers system.</p>`;

  await ses.send(
    new SendEmailCommand({
      Source: SES_FROM_EMAIL,
      Destination: { ToAddresses: toAddresses },
      Message: {
        Subject: { Data: subject },
        Body: {
          Text: { Data: body },
          Html: { Data: html },
        },
      },
    }),
  );
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

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  // Claims are injected by the Cognito REST API authorizer — no JWT re-validation needed
  const claims = event.requestContext.authorizer?.claims as
    | Record<string, string>
    | undefined;
  const facilityIdsStr = claims?.['custom:facility_ids'] ?? '';
  const allowedIds = facilityIdsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!event.body) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing request body' }),
    };
  }

  let body: UpdateStatusBody;
  try {
    body = JSON.parse(event.body) as UpdateStatusBody;
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const { featureId, field, value } = body;

  if (
    typeof featureId !== 'number' ||
    !['Warming_Active', 'Cooling_Active'].includes(field) ||
    typeof value !== 'boolean'
  ) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid request parameters' }),
    };
  }

  // Verify the authenticated user is authorized for this specific facility
  if (!allowedIds.includes(String(featureId))) {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Not authorized for this facility' }),
    };
  }

  try {
    const token = await getArcGISToken();

    const updates = JSON.stringify([
      { attributes: { ObjectID: featureId, [field]: value ? 'Yes' : 'No' } },
    ]);

    const applyEditsParams = new URLSearchParams({
      updates,
      f: 'json',
      token,
    });

    const applyRes = await fetch(`${ARCGIS_FEATURE_LAYER_URL}/applyEdits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: applyEditsParams.toString(),
    });

    const result = (await applyRes.json()) as ArcGISApplyEditsResponse;

    if (result.error) {
      console.error('ArcGIS applyEdits error:', result.error);
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Feature layer update failed' }),
      };
    }

    const updateResult = result.updateResults?.[0];
    if (!updateResult?.success) {
      console.error('ArcGIS update rejected:', updateResult);
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Feature layer rejected the update' }),
      };
    }

    if (value) {
      try {
        let toAddresses: string[];
        try {
          const override = await ddb.send(
            new GetCommand({
              TableName: TABLE_NAME,
              Key: { facilityId: String(featureId) },
              ConsistentRead: true,
            }),
          );
          const perFacilityEmails = override.Item?.notificationEmails as string | undefined;
          toAddresses = perFacilityEmails
            ? perFacilityEmails.split(',').map((e: string) => e.trim()).filter(Boolean)
            : NOTIFICATION_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);
        } catch {
          toAddresses = NOTIFICATION_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);
        }
        const facilityName = await getFacilityName(token, featureId);
        await sendActivationEmail(facilityName, field, toAddresses);
      } catch (emailErr) {
        console.error('Email notification failed (non-fatal):', emailErr);
      }
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Internal error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
