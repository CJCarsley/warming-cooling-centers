import rawOutputs from '../../amplify_outputs.json';

interface AmplifyOutputsShape {
  custom?: { API?: { facilityStatusApiUrl?: string } };
}

const API_BASE = (rawOutputs as AmplifyOutputsShape).custom?.API?.facilityStatusApiUrl ?? '';

interface TokenCache {
  token: string;
  expires: number;
}

let cache: TokenCache | null = null;
let inflightRequest: Promise<TokenCache> | null = null;

export async function getPublicArcGISToken(): Promise<string> {
  // Serve from cache when more than 60s of life remains
  if (cache && cache.expires > Date.now() + 60_000) {
    return cache.token;
  }
  // Deduplicate concurrent callers
  if (!inflightRequest) {
    inflightRequest = fetch(`${API_BASE}arcgis-token`)
      .then((res) => {
        if (!res.ok) throw new Error(`arcgis-token HTTP ${res.status}`);
        return res.json() as Promise<{ token: string; expires: number }>;
      })
      .then((data) => {
        cache = { token: data.token, expires: data.expires };
        inflightRequest = null;
        return cache;
      })
      .catch((err: unknown) => {
        inflightRequest = null;
        throw err;
      });
  }
  const result = await inflightRequest;
  return result.token;
}
