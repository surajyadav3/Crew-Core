/** Last 10 digits of a phone number, stripped of spaces/dashes/country-code prefixes. */
export const normalizePhone = (phone: string) => String(phone || '').replace(/\D/g, '').slice(-10);

/**
 * Employees imported without an email need SOME identifier for their Supabase
 * Auth account — phone-based auth isn't configured in this project, so instead
 * of a real email the web app synthesizes a deterministic, fake-but-valid one
 * from their phone number. It's never shown to anyone; login just re-derives
 * it from whatever phone number is typed in. Must match src/lib/helpers.js's
 * phoneToPlaceholderEmail exactly, since that's the convention employee
 * accounts were actually created under.
 */
export const phoneToPlaceholderEmail = (phone: string) => {
  const digits = normalizePhone(phone);
  return digits ? `p${digits}@phone.crewcore.internal` : '';
};

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape a value for safe interpolation into a raw HTML string. */
export const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/**
 * Single source of truth for password strength, enforced identically at signup,
 * password reset, and forced first-login change — matches the website exactly so a
 * password valid on one surface is never rejected on another.
 * Returns '' if valid, or a user-facing error message.
 */
export function validatePassword(password: string): string {
  if (!password) return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter.';
  if (!/\d/.test(password)) return 'Password must contain at least one number.';
  return '';
}

const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAYS_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export const fmt = (n: number, currency = '₹') => {
  try {
    return currency + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  } catch {
    const num = Math.round(n || 0);
    return currency + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
};

export const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  // Plain YYYY-MM-DD (join_date, DOB) is a calendar date, not an instant —
  // parse it as local midnight so no timezone can shift it a day.
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d);
  try {
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return `${String(dt.getDate()).padStart(2, '0')} ${MONTHS_SHORT[dt.getMonth()]} ${dt.getFullYear()}`;
  }
};

/** User-facing people data (names, department, designation…) is always shown in CAPITALS. */
export const upper = (v: string | null | undefined) => (v || '').toUpperCase();

/** Full name in capitals, skipping missing parts. */
export const personName = (p: any, fallback = '') =>
  upper([p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ')) || fallback;

/**
 * Probation completes `months` (default 6) after the date of joining.
 * Returns { completed, endsOn } where endsOn is YYYY-MM-DD, or null without a join date.
 */
export function probationInfo(joinDate: string | null | undefined, months?: number | null) {
  if (!joinDate) return null;
  const [y, m, d] = joinDate.split('-').map(Number);
  const end = new Date(y, m - 1 + (months || 6), d);
  const endsOn = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { completed: today >= end, endsOn };
}

export const fmtDateTime = (d: string | null | undefined) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch {
    return fmtDate(d);
  }
};

export const monthLabel = (m: number, y: number) => {
  try {
    return new Date(y, m).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  } catch {
    return `${MONTHS_LONG[m]} ${y}`;
  }
};

// Safe clock string (HH:MM:SS AM/PM) — used in attendance tick interval
export const fmtLiveClock = (d: Date) => {
  try {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  } catch {
    const h = d.getHours();
    const m = d.getMinutes();
    const s = d.getSeconds();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${ampm}`;
  }
};

// Safe date string (Weekday, D Month YYYY) — used in attendance tick interval
export const fmtLiveDate = (d: Date) => {
  try {
    return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  }
};

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const dateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Earliest date an employee may still raise a regularize request for —
 * tenants.regularize_window_days counts today, so the default 2 means today
 * and yesterday. The DB trigger enforce_regularize_request_window is the real
 * gate (shared with the website); this just lets the UI hide/explain what the
 * server would reject.
 */
export const regularizeWindowDays = (tenant: any) => Math.max(1, Number(tenant?.regularize_window_days) || 2);

/**
 * A temporary extended window (tenants.regularize_extended_from/_until, web
 * repo migration 20260929_2_regularize_extended_window.sql): while today <=
 * until, any date since `from` may be regularized. Returns null once it has
 * lapsed, so the normal N-day window comes back on its own. Mirrors the
 * website's src/lib/helpers.js.
 */
export const regularizeExtension = (tenant: any): { from: string; until: string } | null => {
  const from = tenant?.regularize_extended_from;
  const until = tenant?.regularize_extended_until;
  if (!from || !until || todayStr() > until) return null;
  return { from, until };
};

const fmtDayMonth = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/**
 * tenants.regularize_current_month (web repo migration
 * 20261011_3_regularize_current_month.sql): any day since the 1st of the
 * current month may be regularized, never fewer days than the normal N-day
 * window. Mirrors the website's src/lib/helpers.js.
 */
const regularizeNormalMinDate = (tenant: any) => {
  const d = new Date();
  d.setDate(d.getDate() - (regularizeWindowDays(tenant) - 1));
  const normal = dateStr(d);
  if (!tenant?.regularize_current_month) return normal;
  const monthStart = todayStr().slice(0, 8) + '01';
  return monthStart < normal ? monthStart : normal;
};

export const regularizeMinDate = (tenant: any) => {
  const normal = regularizeNormalMinDate(tenant);
  const ext = regularizeExtension(tenant);
  return ext && ext.from < normal ? ext.from : normal;
};

export const regularizeWindowLabel = (tenant: any) => {
  const ext = regularizeExtension(tenant);
  if (ext) return `any day from ${fmtDayMonth(ext.from)} to today`;
  if (tenant?.regularize_current_month) return `any day from ${fmtDayMonth(regularizeNormalMinDate(tenant))} to today`;
  const n = regularizeWindowDays(tenant);
  return n === 1 ? 'today' : n === 2 ? 'today or yesterday' : `the last ${n} days`;
};

/** Banner text for the regularize screens while an extended window is open, else null. */
export const regularizeExtensionNotice = (tenant: any) => {
  const ext = regularizeExtension(tenant);
  if (!ext) return null;
  const month = new Date(ext.from + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long' });
  const n = regularizeWindowDays(tenant);
  const after = tenant?.regularize_current_month ? 'only days of the current month' : `only the last ${n} days`;
  return `Until ${fmtDayMonth(ext.until)}, you can regularize any day from ${fmtDayMonth(ext.from)} — please submit all your ${month} mispunch / attendance corrections for approval now. After ${fmtDayMonth(ext.until)}, ${after} can be regularized; older days can no longer be regularized.`;
};

export const timeStr = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export const fmtTime12 = (t: string) => {
  if (!t) return '—';
  const [h, m] = t.split(':');
  const hNum = parseInt(h);
  const ap = hNum >= 12 ? 'PM' : 'AM';
  return `${hNum % 12 || 12}:${m} ${ap}`;
};

export const diffHours = (t1: string, t2: string) => {
  if (!t1 || !t2) return 0;
  const [h1, m1] = t1.split(':').map(Number);
  const [h2, m2] = t2.split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  // Overnight shift (e.g. clock-in 22:00, clock-out 06:00 next day) — wrap past midnight
  // instead of clamping to 0, which silently zeroed every overnight employee's hours.
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
};

const EARLY_LATE_THRESHOLD_MINUTES = 90;

/**
 * Early Left / Late Arrival breach check — a punch-in more than 90 minutes
 * after shift start, OR a punch-out more than 90 minutes before shift end.
 * Mirrors src/lib/helpers.js computeEarlyLateBreach exactly, so web, mobile,
 * and essl-punch can't drift on what counts as a breach.
 */
export function computeEarlyLateBreach(firstPunch: string, lastPunch: string, shiftStart: string, shiftEnd: string): boolean {
  const { lateArrival, earlyLeft } = getEarlyLateBreakdown(firstPunch, lastPunch, shiftStart, shiftEnd);
  return lateArrival || earlyLeft;
}

/** Which side of the 90-minute rule a day breached — for labelling a day as Late Arrival and/or Early Left. */
export function getEarlyLateBreakdown(firstPunch: string, lastPunch: string, shiftStart: string, shiftEnd: string) {
  if (!firstPunch || !lastPunch || !shiftStart || !shiftEnd) return { lateArrival: false, earlyLeft: false };
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return {
    lateArrival: toMin(firstPunch) > toMin(shiftStart) + EARLY_LATE_THRESHOLD_MINUTES,
    earlyLeft: toMin(lastPunch) < toMin(shiftEnd) - EARLY_LATE_THRESHOLD_MINUTES,
  };
}

export const fmtDuration = (hrs: number) => {
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  return `${h}h ${m}m`;
};

// HH:MM:SS from a raw seconds count — used for live-ticking hour totals
// (today's worked time, this month's running total) so they read the same
// way as the live clock instead of the "Xh Ym" summary format.
export const fmtHMS = (totalSeconds: number) => {
  const secs = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const HIGH_SALARY_THRESHOLD = 30000;

// Mirrors src/lib/helpers.js's isRaniwalaTenant exactly — used to branch
// leave-approval display (manager/HR two-stage routing instead of the
// self/manager/admin quota banner) the same way the web app does.
export const isRaniwalaTenant = (tenant: any) => /raniwala/i.test(tenant?.company_name || '');

export const calcPayableOvertimeHours = (minutes: number) => {
  if (!minutes || minutes <= 0) return 0;
  return Math.floor((minutes + 15) / 60);
};

export const calcOtPay = (ctc: number, shiftHours: number, payableHours: number) => {
  if (!ctc || !payableHours) return 0;
  return Math.round((ctc * 0.5) / 30 / (shiftHours || 8) * payableHours);
};

/** FY starts in April (month index 3) — e.g. Jan 2027 → '2026-27', May 2026 → '2026-27'. */
export const currentFinancialYear = (date = new Date()) => {
  const y = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
};

export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Whether a punch's lat/lng falls inside the effective geofence (outlet
 * override, falling back to the tenant default). Returns null (not flagged)
 * when no geofence is configured or no punch coordinates were captured —
 * i.e. this only ever flags, never silently blocks a punch. Mirrors the
 * website's src/lib/helpers.js checkGeofence exactly.
 */
export function checkGeofence(punchLat: number | null | undefined, punchLng: number | null | undefined, outlet: any, tenant: any): boolean | null {
  const center = (outlet?.geofence_lat != null && outlet?.geofence_lng != null)
    ? { lat: outlet.geofence_lat, lng: outlet.geofence_lng, radius: outlet.geofence_radius ?? tenant?.geofence_radius ?? 200 }
    : (tenant?.geofence_lat != null && tenant?.geofence_lng != null)
      ? { lat: tenant.geofence_lat, lng: tenant.geofence_lng, radius: tenant.geofence_radius ?? 200 }
      : null;
  if (!center || punchLat == null || punchLng == null) return null;
  return calculateDistance(punchLat, punchLng, center.lat, center.lng) > center.radius;
}

/**
 * Multi-outlet variant of checkGeofence: a punch counts as "in fence" if it
 * falls inside ANY of the profile's accessible outlets (their home outlet plus
 * any extra clock-in access grants, or every outlet when the tenant has
 * allow_any_outlet_clockin on). Mirrors the website's checkGeofenceMulti exactly.
 */
export function checkGeofenceMulti(punchLat: number | null | undefined, punchLng: number | null | undefined, outlets: any[], tenant: any): boolean | null {
  if (punchLat == null || punchLng == null) return null;
  const candidates = outlets && outlets.length ? outlets : [null];
  let anyConfigured = false;
  for (const outlet of candidates) {
    const result = checkGeofence(punchLat, punchLng, outlet, tenant);
    if (result === null) continue; // no geofence configured for this outlet
    anyConfigured = true;
    if (result === false) return false; // inside this outlet's fence — good enough
  }
  return anyConfigured ? true : null;
}

/**
 * True if geofencing has any coordinates set up at all — either the tenant
 * default or an override on any of the given outlets. Used to tell "no
 * location provided because geofencing isn't configured" (fine) apart from
 * "no location provided even though geofencing IS configured" (suspicious).
 */
export function geofenceIsConfigured(outlets: any[], tenant: any): boolean {
  if (tenant?.geofence_lat != null && tenant?.geofence_lng != null) return true;
  return !!(outlets || []).some((o) => o?.geofence_lat != null && o?.geofence_lng != null);
}

/**
 * An outlet's own `weekly_off_days` (when set) overrides the tenant-wide
 * setting entirely — e.g. Raniwala's Delhi outlet is off Monday while Office
 * and Factory are off Sunday. Falls back to the tenant's `weekly_off_days`,
 * then the legacy single `weekly_off_day` column, then Sunday-only. Mirrors
 * the website's src/lib/helpers.js getTenantWeeklyOffDays exactly.
 */
export function getTenantWeeklyOffDays(tenant: any, outlet: any = null): number[] {
  if (Array.isArray(outlet?.weekly_off_days) && outlet.weekly_off_days.length > 0) {
    return outlet.weekly_off_days;
  }
  if (Array.isArray(tenant?.weekly_off_days) && tenant.weekly_off_days.length > 0) {
    return tenant.weekly_off_days;
  }
  if (tenant?.weekly_off_day !== undefined && tenant?.weekly_off_day !== null) {
    return [tenant.weekly_off_day];
  }
  return [0];
}

/** True if `date` falls on one of the effective (outlet ?? tenant) weekly off days. */
export function isTenantWeeklyOff(date: Date, tenant: any, outlet: any = null): boolean {
  const offDays = getTenantWeeklyOffDays(tenant, outlet);
  return offDays.includes(date.getDay());
}
