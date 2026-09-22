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

export const fmtDate = (d: string | null) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, '0')} ${MONTHS_SHORT[dt.getMonth()]} ${dt.getFullYear()}`;
  }
};

export const fmtDateTime = (d: string | null) => {
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
