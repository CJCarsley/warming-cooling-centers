export const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export interface DayHours {
  closed: boolean;
  open: string;
  close: string;
}

export type WeekHours = Record<DayKey, DayHours>;

export interface ParseResult {
  success: boolean;
  week: WeekHours;
}

const DEFAULT_DAY: DayHours = { closed: true, open: '09:00', close: '17:00' };

export function emptyWeek(): WeekHours {
  return DAY_KEYS.reduce((acc, d) => {
    acc[d] = { ...DEFAULT_DAY };
    return acc;
  }, {} as WeekHours);
}

function to12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

function from12h(token: string): string | null {
  const m = token.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const period = m[3].toUpperCase();
  if (h < 1 || h > 12 || min < 0 || min > 59) return null;
  if (period === 'AM') h = h === 12 ? 0 : h;
  else h = h === 12 ? 12 : h + 12;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

function describeDay(d: DayHours): string {
  if (d.closed) return 'Closed';
  if (d.open === '00:00' && d.close === '23:59') return 'Open 24 hours';
  return `${to12h(d.open)}–${to12h(d.close)}`;
}

function sameSchedule(a: DayHours, b: DayHours): boolean {
  if (a.closed !== b.closed) return false;
  if (a.closed) return true;
  return a.open === b.open && a.close === b.close;
}

export function serializeHours(week: WeekHours): string {
  const segments: string[] = [];
  let i = 0;
  while (i < DAY_KEYS.length) {
    let j = i;
    while (j + 1 < DAY_KEYS.length && sameSchedule(week[DAY_KEYS[j + 1]], week[DAY_KEYS[i]])) {
      j++;
    }
    const range = i === j ? DAY_KEYS[i] : `${DAY_KEYS[i]}–${DAY_KEYS[j]}`;
    segments.push(`${range}: ${describeDay(week[DAY_KEYS[i]])}`);
    i = j + 1;
  }
  return segments.join('; ');
}

const DAY_INDEX: Record<string, number> = {
  mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
};

export function parseHours(value: string): ParseResult {
  const trimmed = (value || '').trim();
  if (!trimmed) return { success: false, week: emptyWeek() };

  const week = emptyWeek();
  const seen = new Set<DayKey>();
  const segments = trimmed.split(/\s*;\s*/);

  for (const seg of segments) {
    const m = seg.match(/^([A-Za-z]+)(?:\s*[–—-]\s*([A-Za-z]+))?\s*:\s*(.+)$/);
    if (!m) return { success: false, week: emptyWeek() };
    const startIdx = DAY_INDEX[m[1].slice(0, 3).toLowerCase()];
    const endIdx = m[2] ? DAY_INDEX[m[2].slice(0, 3).toLowerCase()] : startIdx;
    if (startIdx === undefined || endIdx === undefined || endIdx < startIdx) {
      return { success: false, week: emptyWeek() };
    }

    const spec = m[3].trim();
    let dayHours: DayHours;
    if (/^closed$/i.test(spec)) {
      dayHours = { closed: true, open: '09:00', close: '17:00' };
    } else if (/^open\s*24\s*hours?$/i.test(spec) || /^24\/7$/i.test(spec)) {
      dayHours = { closed: false, open: '00:00', close: '23:59' };
    } else {
      const rangeMatch = spec.match(/^(.+?)\s*[–—-]\s*(.+)$/);
      if (!rangeMatch) return { success: false, week: emptyWeek() };
      const open = from12h(rangeMatch[1]);
      const close = from12h(rangeMatch[2]);
      if (!open || !close) return { success: false, week: emptyWeek() };
      dayHours = { closed: false, open, close };
    }

    for (let k = startIdx; k <= endIdx; k++) {
      const key = DAY_KEYS[k];
      if (seen.has(key)) return { success: false, week: emptyWeek() };
      seen.add(key);
      week[key] = { ...dayHours };
    }
  }

  if (seen.size !== DAY_KEYS.length) return { success: false, week: emptyWeek() };
  return { success: true, week };
}
