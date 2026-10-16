// Half-day leave (web repo migration 20261013_2): leave_requests.half_day is
// 'first_half' / 'second_half' for half of one date, null for whole days.
// half_day_from / half_day_to are that half of the employee's shift, stamped
// by the DB when they applied. Same helpers as the web's src/lib/halfDayLeave.js.

export type HalfDay = '' | 'first_half' | 'second_half';

export type HalfDayWindows = {
  shift_name: string | null;
  shift_start: string;
  shift_end: string;
  first_half: { from: string; to: string };
  second_half: { from: string; to: string };
};

export const HALF_DAY_OPTIONS: { value: HalfDay; label: string }[] = [
  { value: '', label: 'Full day' },
  { value: 'first_half', label: 'First half' },
  { value: 'second_half', label: 'Second half' },
];

const HALF_NAMES: Record<string, string> = { first_half: 'First half', second_half: 'Second half' };

/** '14:47' / '14:47:00' -> '2:47 PM'. */
export function clock12(t?: string | null) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** 'First half · 10:20 AM – 2:47 PM' (times left out when unknown). */
export function halfDayLabel(half?: string | null, from?: string | null, to?: string | null) {
  const name = half ? HALF_NAMES[half] : '';
  if (!name) return '';
  return from && to ? `${name} · ${clock12(from)} – ${clock12(to)}` : name;
}

/** A request's own label, or '' for a full-day request. */
export const requestHalfDayLabel = (req: any) => halfDayLabel(req?.half_day, req?.half_day_from, req?.half_day_to);
