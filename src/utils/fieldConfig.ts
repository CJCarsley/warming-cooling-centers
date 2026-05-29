import type { FieldDef } from './fieldSchemaCache';

// Saved edit-form field configuration: an ordered list of field names that
// SuperAdmin has enabled. Empty array = no configuration → fall back to the
// full editable schema (legacy behavior). Cached at module scope so the value
// set on Save is visible immediately to other views without a network round-trip.
let cache: string[] | null = null;
let inflight: Promise<string[]> | null = null;

export async function getFieldConfig(apiBase: string, idToken: string): Promise<string[]> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = fetch(`${apiBase}admin/field-config`, { headers: { Authorization: idToken } })
    .then((res) => (res.ok ? res.json() : { fields: [] }))
    .then((data: { fields?: string[] }) => {
      cache = data.fields ?? [];
      inflight = null;
      return cache;
    })
    .catch((err: unknown) => {
      console.error('getFieldConfig error:', err);
      inflight = null;
      return [];
    });

  return inflight;
}

export function setFieldConfigCache(fields: string[]): void {
  cache = fields;
}

// Order + filter a schema to the saved configuration. When no config is saved
// (empty), the full schema is returned unchanged so existing facilities keep
// every editable field. Names in the config that no longer exist are dropped.
export function applyFieldConfig(fields: FieldDef[], config: string[] | null): FieldDef[] {
  if (!config || config.length === 0) return fields;
  const byName = new Map(fields.map((f) => [f.name, f]));
  const out: FieldDef[] = [];
  for (const name of config) {
    const f = byName.get(name);
    if (f) out.push(f);
  }
  return out;
}
