import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors as C } from '@/constants/Colors';
import { fmtDate } from '@/lib/helpers';

// Port of the website's Leave Tracker (src/components/LeaveTracker.jsx), so an
// employee sees the same figures in the app and on the web.

const COMP_OFF = 'Comp Off';
const ROWS_SHOWN = 8;

export const fmtDays = (n: number | null | undefined) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, '');
};
const dayWord = (n: number) => `day${Number(n) === 1 ? '' : 's'}`;

export const requestDays = (req: { start_date: string; end_date: string }) =>
  Math.ceil(Math.abs(new Date(req.end_date).getTime() - new Date(req.start_date).getTime()) / 86400000) + 1;
const requestDates = (req: any) => (req.start_date === req.end_date
  ? fmtDate(req.start_date)
  : `${fmtDate(req.start_date)} – ${fmtDate(req.end_date)}`);

// HR records a leave that was never applied for in the app as a negative
// Allocation whose note starts "Leave taken" (see the web's LeaveBalancesPage).
const isLeaveTaken = (e: any) => e.entry_type === 'Deduction'
  || (e.entry_type === 'Allocation' && Number(e.days) < 0 && /^leave taken/i.test(e.note || ''));

function entryLabel(e: any) {
  if (isLeaveTaken(e)) return 'Leave taken';
  if (e.entry_type === 'Accrual') return 'Leave credited';
  if (e.entry_type === 'Allocation') return Number(e.days) >= 0 ? 'Added by HR' : 'Adjusted by HR';
  if (e.entry_type === 'Carry Forward') return 'Carried forward';
  if (e.entry_type === 'Encashment') return 'Encashed';
  if (e.entry_type === 'Expiry') return 'Lapsed';
  return e.entry_type;
}

function Figure({ label, value, sign = '', tone, strong }: {
  label: string; value: number; sign?: string; tone?: string; strong?: boolean;
}) {
  return (
    <View style={s.figure}>
      <Text style={s.figureLabel}>{label}</Text>
      <Text style={[s.figureValue, strong && { fontSize: 22 }, !!tone && { color: tone }]}>
        {sign}{fmtDays(value)}<Text style={s.figureUnit}> {dayWord(value)}</Text>
      </Text>
    </View>
  );
}

type TrackerType = { id: string; name: string; hasLedger: boolean; paid: boolean; balance?: number };
type Row = { key: string; date: string; label: string; detail?: string; days: number; balance: number | null; pending?: boolean };

/**
 * The statement behind one leave type: every credit and leave taken with the
 * balance it left, then what the balance becomes once pending requests go
 * through. Types with no ledger (unlimited ones and Comp Off, a plain counter)
 * list the approved requests instead.
 */
function buildStatement(type: TrackerType, ledger: any[], requests: any[]) {
  const reqById = new Map(requests.map((r) => [r.id, r]));
  const mine = requests.filter((r) => r.leave_type === type.name);
  const st = { credited: 0, taken: 0, adjusted: 0, balance: 0 as number | null, pending: 0, projected: 0 as number | null, rows: [] as Row[] };

  if (type.hasLedger) {
    let bal = 0;
    ledger.filter((e) => e.leave_type_id === type.id).forEach((e) => {
      const days = Number(e.days) || 0;
      const req = reqById.get(e.leave_request_id);
      bal += days;
      if (days >= 0) st.credited += days;
      else if (isLeaveTaken(e)) st.taken -= days;
      else st.adjusted -= days;
      st.rows.push({
        key: e.id,
        date: e.effective_date,
        label: entryLabel(e),
        detail: req ? [requestDates(req), req.reason].filter(Boolean).join(' · ') : e.note,
        days,
        balance: bal,
      });
    });
    st.balance = bal;
  } else {
    mine.filter((r) => r.status === 'Approved')
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .forEach((r) => {
        const days = requestDays(r);
        st.taken += days;
        st.rows.push({ key: r.id, date: r.start_date, label: 'Leave taken', detail: [requestDates(r), r.reason].filter(Boolean).join(' · '), days: -days, balance: null });
      });
    st.balance = type.balance ?? null;
  }

  let projected = st.balance;
  mine.filter((r) => r.status === 'Pending')
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .forEach((r) => {
      const days = requestDays(r);
      st.pending += days;
      if (projected != null) projected -= days;
      st.rows.push({ key: r.id, date: r.start_date, label: 'Awaiting approval', detail: [requestDates(r), r.reason].filter(Boolean).join(' · '), days: -days, balance: projected, pending: true });
    });
  st.projected = projected;
  st.rows.reverse(); // newest first — pending requests on top
  return st;
}

/**
 * Leave Tracker — pick a leave type, see how its balance was reached.
 * `compOffBalance` adds the Comp Off tab; pass null to leave it out.
 */
export function LeaveTracker({ leaveTypes, ledger, requests, compOffBalance }: {
  leaveTypes: any[]; ledger: any[]; requests: any[]; compOffBalance: number | null;
}) {
  const types: TrackerType[] = [
    ...leaveTypes.map((t) => ({ id: t.id, name: t.name, hasLedger: !t.is_unlimited, paid: t.is_paid !== false })),
    ...(compOffBalance != null ? [{ id: COMP_OFF, name: COMP_OFF, hasLedger: false, balance: compOffBalance, paid: true }] : []),
  ];
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (types.length === 0) return null;

  const type = types.find((t) => t.id === activeId) || types[0];
  const st = buildStatement(type, ledger, requests);
  const hasBalance = st.balance != null;
  const rows = showAll ? st.rows : st.rows.slice(0, ROWS_SHOWN);

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Leave Tracker</Text>
      <View style={s.tabs}>
        {types.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[s.tab, t.id === type.id && s.tabActive]}
            onPress={() => { setActiveId(t.id); setShowAll(false); }}
            activeOpacity={0.8}
          >
            <Text style={[s.tabText, t.id === type.id && s.tabTextActive]}>{t.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.figures}>
        {type.hasLedger && <Figure label="Total credited" value={st.credited} sign="+" tone={C.success} />}
        <Figure label="Leave taken" value={st.taken} sign={st.taken ? '−' : ''} tone={st.taken ? C.danger : undefined} />
        {st.adjusted > 0 && <Figure label="Other deductions" value={st.adjusted} sign="−" tone={C.danger} />}
        {hasBalance && <Figure label="Balance now" value={st.balance!} strong={!st.pending} tone={st.balance! < 0 ? C.danger : C.success} />}
        {st.pending > 0 && <Figure label="Awaiting approval" value={st.pending} tone={C.warning} />}
        {hasBalance && st.pending > 0 && (
          <Figure label="Balance if approved" value={st.projected!} strong tone={st.projected! < 0 ? C.danger : C.success} />
        )}
      </View>
      {!hasBalance && (
        <Text style={s.hint}>
          {type.paid ? 'No balance is kept for this leave type.' : 'Loss of Pay — no balance is kept, these days are not paid.'}
        </Text>
      )}

      {rows.length === 0 ? (
        <Text style={s.empty}>Nothing recorded for {type.name} yet.</Text>
      ) : rows.map((r) => {
        const tone = r.pending ? C.warning : r.days >= 0 ? C.success : C.danger;
        return (
          <View key={r.key} style={s.row}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={s.rowDate}>{fmtDate(r.date)}</Text>
                <Text style={[s.rowLabel, { color: tone, backgroundColor: tone + '1F' }]}>{r.label}</Text>
              </View>
              {!!r.detail && <Text style={s.rowDetail} numberOfLines={2}>{r.detail}</Text>}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[s.rowDays, { color: tone }]}>
                {r.days > 0 ? '+' : r.days < 0 ? '−' : ''}{fmtDays(Math.abs(r.days))}
              </Text>
              <Text style={[s.rowBal, r.balance != null && r.balance < 0 && !r.pending && { color: C.danger }]}>
                {r.balance == null ? '—' : `Bal ${fmtDays(r.balance)}`}{r.pending && r.balance != null ? ' if approved' : ''}
              </Text>
            </View>
          </View>
        );
      })}
      {st.rows.length > ROWS_SHOWN && (
        <TouchableOpacity style={s.moreBtn} onPress={() => setShowAll((v) => !v)}>
          <Text style={s.moreText}>{showAll ? 'Show less' : `Show all ${st.rows.length} entries`}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    marginHorizontal: 16, marginBottom: 10, backgroundColor: C.surface, borderRadius: 18, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: C.text, marginBottom: 10 },
  figures: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  figure: { width: '50%', paddingRight: 8 },
  figureLabel: { fontSize: 9.5, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  figureValue: { fontSize: 17, fontWeight: '800', color: C.text, marginTop: 2 },
  figureUnit: { fontSize: 11, fontWeight: '500', color: C.muted },
  hint: { flex: 1, fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 4 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  tab: { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  tabActive: { backgroundColor: C.primary, borderColor: C.primary },
  tabText: { fontSize: 12, fontWeight: '600', color: C.text },
  tabTextActive: { color: '#fff' },
  empty: { fontSize: 12.5, color: C.muted, textAlign: 'center', paddingVertical: 18 },
  row: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 10, marginTop: 4,
  },
  rowDate: { fontSize: 12, fontWeight: '600', color: C.text },
  rowLabel: { fontSize: 10, fontWeight: '700', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  rowDetail: { fontSize: 11.5, color: C.muted, marginTop: 3, lineHeight: 16 },
  rowDays: { fontSize: 14, fontWeight: '800' },
  rowBal: { fontSize: 10.5, color: C.muted, marginTop: 2 },
  moreBtn: { alignSelf: 'center', marginTop: 8, paddingVertical: 8, paddingHorizontal: 14 },
  moreText: { fontSize: 12.5, fontWeight: '700', color: C.primary },
});
