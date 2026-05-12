import type { APIGatewayProxyResult } from 'aws-lambda';

const ARCGIS_TOKEN_URL = 'https://www.arcgis.com/sharing/rest/oauth2/token';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface ArcGISTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: unknown;
}

export const handler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const params = new URLSearchParams({
      client_id: process.env.ARCGIS_CLIENT_ID!,
      client_secret: process.env.ARCGIS_CLIENT_SECRET!,
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
      console.error('ArcGIS token error:', data.error);
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Failed to obtain token' }),
      };
    }

    // Subtract a 60-second buffer so the client refreshes before true expiry
    const expiresMs = Date.now() + ((data.expires_in ?? 7200) - 60) * 1000;

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ token: data.access_token, expires: expiresMs }),
    };
  } catch (err) {
    console.error('getArcGISPublicToken error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
