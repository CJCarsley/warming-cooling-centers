import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getArcGISToken } from '../shared/arcgisToken';
import { parseHours, type DayKey } from '../shared/hours';

const TABLE_NAME = process.env.TABLE_NAME!;
const ARCGIS_FEATURE_LAYER_URL = process.env.ARCGIS_FEATURE_LAYER_URL!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ArcGISQueryResponse {
  features?: Array<{ attributes: { ObjectID: number; Hours: string | null } }>;
  error?: { code: number; message: string };
}

interface ArcGISApplyEditsResponse {
  updateResults?: Array<{ objectId: number; success: boolean }>;
  error?: { code: number; message: string };
}

function nowInCentral(): { dayKey: DayKey; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const weekday = parts.find((p) => p.type === 'weekday')!.value as DayKey;
  let hour = parts.find((p) => p.type === 'hour')!.value;
  const minute = parts.find((p) => p.type === 'minute')!.value;
  // Node's Intl returns '24' for midnight in some versions; normalize to '00'
  if (hour === '24') hour = '00';
  return { dayKey: weekday, hhmm: `${hour}:${minute}` };
}

export const handler = async (): Promise<void> => {
  const { dayKey, hhmm } = nowInCentral();
  console.log(`autoCloseByHours: current CT time ${dayKey} ${hhmm}`);

  const token = await getArcGISToken();

  const queryParams = new URLSearchParams({
    where: "Warming_Active='Yes' OR Cooling_Active='Yes'",
    outFields: 'ObjectID,Hours',
    returnGeometry: 'false',
    f: 'json',
    token,
  });

  const queryRes = await fetch(`${ARCGIS_FEATURE_LAYER_URL}/query?${queryParams}`);
  const queryData = (await queryRes.json()) as ArcGISQueryResponse;

  if (queryData.error) {
    console.error('ArcGIS query error:', queryData.error);
    return;
  }

  const activeFacilities = queryData.features ?? [];
  if (activeFacilities.length === 0) {
    console.log('No active facilities');
    return;
  }

  const candidates: number[] = [];
  for (const f of activeFacilities) {
    const id = f.attributes.ObjectID;
    const hoursStr = f.attributes.Hours ?? '';
    const parsed = parseHours(hoursStr);
    if (!parsed.success) {
      console.log(`Facility ${id}: Hours doesn't parse — defer to nightly reset`);
      continue;
    }
    const today = parsed.week[dayKey];
    if (today.closed) {
      console.log(`Facility ${id}: today (${dayKey}) is Closed per Hours — defer to nightly reset`);
      continue;
    }
    if (today.open >= today.close) {
      console.log(`Facility ${id}: overnight schedule — defer to nightly reset`);
      continue;
    }
    if (hhmm <= today.close) continue;
    candidates.push(id);
  }

  if (candidates.length === 0) {
    console.log('No facilities past closing time');
    return;
  }

  let keepOpenIds = new Set<string>();
  try {
    const scanResult = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'keepOpen = :t',
        ExpressionAttributeValues: { ':t': true },
        ProjectionExpression: 'facilityId',
        ConsistentRead: true,
      }),
    );
    keepOpenIds = new Set((scanResult.Items ?? []).map((i) => String(i.facilityId)));
  } catch (err) {
    console.error('keepOpen Scan failed; aborting (fail-safe — no facilities closed):', err);
    return;
  }

  const toClose = candidates.filter((id) => !keepOpenIds.has(String(id)));
  if (toClose.length === 0) {
    console.log(`All ${candidates.length} candidates have keep-open overrides`);
    return;
  }

  const updates = toClose.map((id) => ({
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
  console.log(`autoCloseByHours: ${succeeded}/${toClose.length} facilities closed at end of day`);
};
