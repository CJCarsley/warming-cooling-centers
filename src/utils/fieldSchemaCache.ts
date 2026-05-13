import { getPublicArcGISToken } from './arcgisToken';

const FEATURE_LAYER_URL =
  'https://services.arcgis.com/pDAi2YK0L0QxVJHj/arcgis/rest/services/Warming_and_Cooling_Centers/FeatureServer/0';

export interface CodedValue {
  code: string | number;
  name: string;
}

export interface FieldDomain {
  type: string;
  codedValues?: CodedValue[];
}

export interface FieldDef {
  name: string;
  alias: string;
  type: string;
  nullable?: boolean;
  editable?: boolean;
  domain?: FieldDomain | null;
  defaultValue?: unknown;
}

const SYSTEM_FIELDS = new Set([
  'OBJECTID', 'ObjectID', 'GlobalID', 'CreationDate', 'Creator',
  'EditDate', 'Editor', 'Shape', 'Shape__Area', 'Shape__Length',
]);

let cachedSchema: FieldDef[] | null = null;
let fetchPromise: Promise<FieldDef[]> | null = null;

export async function getFieldSchema(): Promise<FieldDef[]> {
  if (cachedSchema) return cachedSchema;
  if (fetchPromise) return fetchPromise;

  fetchPromise = getPublicArcGISToken()
    .then((token) => fetch(`${FEATURE_LAYER_URL}?f=json&token=${encodeURIComponent(token)}`))
    .then((res) => res.json())
    .then((data: { fields?: FieldDef[] }) => {
      const fields = (data.fields ?? []).filter(
        (f) => !SYSTEM_FIELDS.has(f.name) && f.editable !== false,
      );
      cachedSchema = fields;
      fetchPromise = null;
      return fields;
    })
    .catch((err: unknown) => {
      fetchPromise = null;
      throw err;
    });

  return fetchPromise;
}
