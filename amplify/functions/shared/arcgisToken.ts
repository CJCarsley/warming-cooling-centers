const ARCGIS_TOKEN_URL = 'https://www.arcgis.com/sharing/rest/oauth2/token';

interface ArcGISTokenResponse {
  access_token?: string;
  error?: { code: number; message: string };
}

export async function getArcGISToken(): Promise<string> {
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
  if (!data.access_token) throw new Error(`ArcGIS token error: ${JSON.stringify(data.error)}`);
  return data.access_token;
}
