import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getArcGISToken } from '../shared/arcgisToken';

const TABLE_NAME = process.env.TABLE_NAME!;
const ARCGIS_FEATURE_LAYER_URL = process.env.ARCGIS_FEATURE_LAYER_URL!;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? '';
const SES_REGION = process.env.SES_REGION ?? 'us-east-1';
const APP_URL = process.env.APP_URL ?? '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({ region: SES_REGION });

interface ArcGISQueryResponse {
  features?: Array<{ attributes: { ObjectID: number; Name?: string } }>;
  error?: { code: number; message: string };
}

interface ArcGISApplyEditsResponse {
  updateResults?: Array<{ objectId: number; success: boolean }>;
  error?: { code: number; message: string };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function nextReminderDay(reminderCount: number): number {
  // 3, 7, 21, 35, 49, ... — first at day 3, then 4 days later, then every 14 days
  if (reminderCount <= 0) return 3;
  if (reminderCount === 1) return 7;
  return 7 + 14 * (reminderCount - 1);
}

async function getFacilityNames(
  token: string,
  ids: number[],
): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  if (ids.length === 0) return names;
  const params = new URLSearchParams({
    objectIds: ids.join(','),
    outFields: 'ObjectID,Name',
    returnGeometry: 'false',
    f: 'json',
    token,
  });
  try {
    const res = await fetch(`${ARCGIS_FEATURE_LAYER_URL}/query?${params}`);
    const data = (await res.json()) as ArcGISQueryResponse;
    for (const f of data.features ?? []) {
      names.set(f.attributes.ObjectID, f.attributes.Name ?? `Facility #${f.attributes.ObjectID}`);
    }
  } catch (err) {
    console.error('getFacilityNames error (non-fatal):', err);
  }
  return names;
}

async function sendReminderEmail(
  facilityName: string,
  daysOpen: number,
  toAddresses: string[],
): Promise<void> {
  if (!toAddresses.length || !SES_FROM_EMAIL) {
    console.log(`Skipping reminder for ${facilityName}: no recipients or SES_FROM_EMAIL unset`);
    return;
  }
  const subject = `Keep Open reminder: ${facilityName} (open ${daysOpen} days)`;
  const text =
    `${facilityName} has had the Keep Open override active for ${daysOpen} day${daysOpen === 1 ? '' : 's'}.\n\n` +
    `Please review this facility to confirm it should remain open, or disable Keep Open if it no longer needs to skip the nightly reset.\n\n` +
    (APP_URL ? `Manage facilities: ${APP_URL}\n\n` : '') +
    `This is an automated reminder from the Douglas County Warming & Cooling Centers system.`;
  const html =
    `<p><strong>${facilityName}</strong> has had the Keep Open override active for <strong>${daysOpen} day${daysOpen === 1 ? '' : 's'}</strong>.</p>` +
    `<p>Please review this facility to confirm it should remain open, or disable Keep Open if it no longer needs to skip the nightly reset.</p>` +
    (APP_URL ? `<p><a href="${APP_URL}">Manage facilities</a></p>` : '') +
    `<p style="color:#666;font-size:0.9em">This is an automated reminder from the Douglas County Warming &amp; Cooling Centers system.</p>`;

  await ses.send(
    new SendEmailCommand({
      Source: SES_FROM_EMAIL,
      Destination: { ToAddresses: toAddresses },
      Message: {
        Subject: { Data: subject },
        Body: { Text: { Data: text }, Html: { Data: html } },
      },
    }),
  );
}

interface KeepOpenItem {
  facilityId: string;
  keepOpenSince?: number;
  reminderCount?: number;
  notificationEmails?: string;
}

async function processReminders(token: string, items: KeepOpenItem[]): Promise<void> {
  const now = Date.now();
  const dueItems: Array<{ id: number; daysOpen: number; emails: string[]; nextCount: number; item: KeepOpenItem }> = [];

  for (const item of items) {
    // Backfill legacy items without timestamp tracking — they get the day-3 reminder
    // 3 days from now, not retroactively (we have no idea when they were enabled).
    if (item.keepOpenSince == null) {
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { facilityId: item.facilityId },
            UpdateExpression: 'SET keepOpenSince = :now, reminderCount = :zero',
            ConditionExpression: 'attribute_not_exists(keepOpenSince)',
            ExpressionAttributeValues: { ':now': now, ':zero': 0 },
          }),
        );
        console.log(`Backfilled keepOpenSince for facility ${item.facilityId}`);
      } catch (err) {
        console.error(`Backfill failed for ${item.facilityId} (non-fatal):`, err);
      }
      continue;
    }

    const reminderCount = item.reminderCount ?? 0;
    const daysOpen = Math.floor((now - item.keepOpenSince) / DAY_MS);
    const dueAt = nextReminderDay(reminderCount);
    if (daysOpen < dueAt) continue;

    const emails = (item.notificationEmails ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    dueItems.push({
      id: Number(item.facilityId),
      daysOpen,
      emails,
      nextCount: reminderCount + 1,
      item,
    });
  }

  if (dueItems.length === 0) {
    console.log('No keep-open reminders due');
    return;
  }

  const names = await getFacilityNames(token, dueItems.map((d) => d.id));

  for (const due of dueItems) {
    const facilityName = names.get(due.id) ?? `Facility #${due.id}`;
    try {
      await sendReminderEmail(facilityName, due.daysOpen, due.emails);
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { facilityId: due.item.facilityId },
          UpdateExpression: 'SET reminderCount = :c',
          ExpressionAttributeValues: { ':c': due.nextCount },
        }),
      );
      console.log(`Reminder #${due.nextCount} sent for facility ${due.id} (open ${due.daysOpen} days)`);
    } catch (err) {
      console.error(`Reminder for facility ${due.id} failed (will retry next run):`, err);
    }
  }
}

export const handler = async (): Promise<void> => {
  const token = await getArcGISToken();

  // ── Existing midnight-reset logic ──
  const queryParams = new URLSearchParams({
    where: "Warming_Active='Yes' OR Cooling_Active='Yes'",
    outFields: 'ObjectID',
    returnGeometry: 'false',
    f: 'json',
    token,
  });

  const queryRes = await fetch(`${ARCGIS_FEATURE_LAYER_URL}/query?${queryParams.toString()}`);
  const queryData = (await queryRes.json()) as ArcGISQueryResponse;

  if (queryData.error) {
    console.error('ArcGIS query error:', queryData.error);
    return;
  }

  const activeFacilities = queryData.features ?? [];

  // Single Scan picks up both keep-open IDs (for skip-reset) and full items
  // (for reminder processing), avoiding a duplicate Scan in the same Lambda run.
  let keepOpenItems: KeepOpenItem[];
  try {
    const scanResult = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'keepOpen = :t',
        ExpressionAttributeValues: { ':t': true },
        ConsistentRead: true,
      }),
    );
    keepOpenItems = (scanResult.Items ?? []) as KeepOpenItem[];
    const idList = keepOpenItems.map((i) => i.facilityId);
    console.log(`keepOpen overrides active: [${idList.join(', ') || 'none'}]`);
  } catch (err) {
    console.error('DynamoDB Scan failed; proceeding without keepOpen data (fail-safe — no facilities will be reset):', err);
    return;
  }

  const keepOpenIds = new Set(keepOpenItems.map((i) => i.facilityId));

  if (activeFacilities.length === 0) {
    console.log('No active facilities to reset');
  } else {
    const toReset: number[] = [];
    for (const feature of activeFacilities) {
      const id = feature.attributes.ObjectID;
      if (keepOpenIds.has(String(id))) {
        console.log(`Facility ${id} has keep-open override; skipping`);
      } else {
        toReset.push(id);
      }
    }

    if (toReset.length === 0) {
      console.log(
        `All ${activeFacilities.length} active facilities have keep-open overrides; skipping reset`,
      );
    } else {
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
      } else {
        const succeeded = (applyData.updateResults ?? []).filter((r) => r.success).length;
        console.log(`Auto-reset complete: ${succeeded}/${toReset.length} facilities deactivated`);
      }
    }
  }

  // ── Keep-Open reminder processing ──
  await processReminders(token, keepOpenItems);
};
