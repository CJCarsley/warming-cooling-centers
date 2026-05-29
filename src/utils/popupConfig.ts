import rawOutputs from '../../amplify_outputs.json';

// Saved map pop-up layout: an ordered list of sections, each with a free-text
// title and an ordered list of field names. Empty array = no saved config →
// the pop-up falls back to DEFAULT_POPUP_LAYOUT (translated section titles).
export interface PopupSection {
  id: string;
  title: string;
  fields: string[];
}

interface AmplifyOutputsShape {
  custom?: { API?: { facilityStatusApiUrl?: string } };
}
const apiBase = (rawOutputs as AmplifyOutputsShape).custom?.API?.facilityStatusApiUrl ?? '';

// The default layout mirrors the original hard-coded pop-up. `titleKey` is an
// i18n key under `popup.sections.*`, so the default stays translated until an
// admin saves a custom layout (whose titles are literal strings).
export interface DefaultSection {
  titleKey: string;
  fields: string[];
}

export const DEFAULT_POPUP_LAYOUT: DefaultSection[] = [
  { titleKey: 'popup.sections.locationAccess', fields: ['Address', 'Nearest_Bus_Stop'] },
  { titleKey: 'popup.sections.contact', fields: ['Phone', 'Email', 'Website'] },
  { titleKey: 'popup.sections.hoursCapacity', fields: ['Hours', 'Capacity', 'Capacity_Status'] },
  {
    titleKey: 'popup.sections.accessibilityServices',
    fields: ['ADA_Compliant', 'Pet_Accessibility', 'Charging_Stations', 'Language_Services', 'Hydration'],
  },
  { titleKey: 'popup.sections.eligibility', fields: ['Eligibility'] },
];

// Field name → `facility.*` i18n label key. Fields outside this map fall back
// to the schema alias, then the raw field name.
export const FIELD_LABEL_KEYS: Record<string, string> = {
  Name: 'facility.name',
  Address: 'facility.address',
  Nearest_Bus_Stop: 'facility.nearestBusStop',
  Phone: 'facility.phone',
  Email: 'facility.email',
  Website: 'facility.website',
  Hours: 'facility.hours',
  Capacity: 'facility.capacity',
  Capacity_Status: 'facility.capacityStatus',
  ADA_Compliant: 'facility.adaCompliant',
  Pet_Accessibility: 'facility.petAccessibility',
  Charging_Stations: 'facility.chargingStations',
  Language_Services: 'facility.languageServices',
  Hydration: 'facility.hydration',
  Eligibility: 'facility.eligibility',
};

let cache: PopupSection[] | null = null;
let inflight: Promise<PopupSection[]> | null = null;
const subscribers = new Set<(sections: PopupSection[]) => void>();

// Public GET — the pop-up is shown to unauthenticated users, so this route
// carries no Cognito authorizer.
export async function getPublicPopupConfig(): Promise<PopupSection[]> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = fetch(`${apiBase}admin/popup-config`)
    .then((res) => (res.ok ? res.json() : { sections: [] }))
    .then((data: { sections?: PopupSection[] }) => {
      cache = data.sections ?? [];
      inflight = null;
      return cache;
    })
    .catch((err: unknown) => {
      console.error('getPopupConfig error:', err);
      inflight = null;
      return [];
    });

  return inflight;
}

export function getCachedPopupConfig(): PopupSection[] | null {
  return cache;
}

export function setPopupConfigCache(sections: PopupSection[]): void {
  cache = sections;
  subscribers.forEach((fn) => fn(sections));
}

export function subscribePopupConfig(fn: (sections: PopupSection[]) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
