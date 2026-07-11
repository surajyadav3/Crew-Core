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
  return Math.max(0, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60);
};

export const fmtDuration = (hrs: number) => {
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  return `${h}h ${m}m`;
};

export const HIGH_SALARY_THRESHOLD = 30000;

export const calcPayableOvertimeHours = (minutes: number) => {
  if (!minutes || minutes <= 0) return 0;
  return Math.floor((minutes + 15) / 60);
};

export const calcOtPay = (ctc: number, shiftHours: number, payableHours: number) => {
  if (!ctc || !payableHours) return 0;
  return Math.round((ctc * 0.5) / 30 / (shiftHours || 8) * payableHours);
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
