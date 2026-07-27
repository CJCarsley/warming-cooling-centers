// ArcGIS World geocoder helpers. Locations come back in WGS84 (x = longitude,
// y = latitude), matching the geometry the feature layer / directions expect.
const GEOCODE_BASE =
  'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';

export interface GeocodeResult {
  x: number; // longitude (WGS84)
  y: number; // latitude (WGS84)
  matchAddr: string;
  score: number;
}

export interface AddressSuggestion {
  text: string;
  magicKey: string;
}

function parseCandidate(json: unknown): GeocodeResult | null {
  const data = json as {
    candidates?: Array<{ address: string; location: { x: number; y: number }; score: number }>;
  };
  const c = data.candidates?.[0];
  if (!c || typeof c.location?.x !== 'number' || typeof c.location?.y !== 'number') return null;
  return { x: c.location.x, y: c.location.y, matchAddr: c.address, score: c.score };
}

// Free-text geocode (fallback when the user typed an address without picking a suggestion).
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({
    SingleLine: address,
    f: 'json',
    maxLocations: '1',
    outFields: 'Match_addr',
    countryCode: 'USA',
  });
  const res = await fetch(`${GEOCODE_BASE}/findAddressCandidates?${params.toString()}`);
  return parseCandidate(await res.json());
}

// Typeahead suggestions for the address combobox.
export async function suggestAddresses(text: string): Promise<AddressSuggestion[]> {
  const params = new URLSearchParams({
    text,
    f: 'json',
    countryCode: 'USA',
    maxSuggestions: '5',
  });
  const res = await fetch(`${GEOCODE_BASE}/suggest?${params.toString()}`);
  const data = (await res.json()) as {
    suggestions?: Array<{ text: string; magicKey: string; isCollection: boolean }>;
  };
  return (data.suggestions ?? [])
    .filter((s) => !s.isCollection && s.magicKey)
    .map((s) => ({ text: s.text, magicKey: s.magicKey }));
}

// Resolve a picked suggestion to precise coordinates.
export async function geocodeByMagicKey(text: string, magicKey: string): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({
    SingleLine: text,
    magicKey,
    f: 'json',
    maxLocations: '1',
    outFields: 'Match_addr',
  });
  const res = await fetch(`${GEOCODE_BASE}/findAddressCandidates?${params.toString()}`);
  return parseCandidate(await res.json());
}
