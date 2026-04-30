import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { fetchMyPayslip } from '@/services/payrollService';
import { fmt, monthLabel } from '@/lib/helpers';

const C = {
  primary: '#00AEEF',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  text: '#1E293B',
  muted: '#94A3B8',
  border: '#E2E8F0',
  success: '#22C55E',
  danger: '#EF4444',
  warning: '#F59E0B',
};

function Amt({ value, show }: { value: number; show: boolean }) {
  if (!show) return <Text style={s.masked}>₹ ••••••</Text>;
  return <Text style={s.amtText}>{fmt(value)}</Text>;
}

function PayslipRow({ label, value, show, bold, isTotal }: {
  label: string; value: number; show: boolean; bold?: boolean; isTotal?: boolean;
}) {
  return (
    <View style={[s.row, isTotal && s.totalRow, bold && { borderTopWidth: 1, borderTopColor: C.border }]}>
      <Text style={[s.rowLabel, (bold || isTotal) && { fontWeight: '700', color: isTotal ? C.success : C.text }]}>
        {label}
      </Text>
      <Amt value={value} show={show} />
    </View>
  );
}

export default function PayslipsScreen() {
  const { profile, tenant } = useAuth();
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [slip, setSlip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAmounts, setShowAmounts] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile || !tenant) return;
    setLoading(true);
    const { data } = await fetchMyPayslip(tenant.id, profile.id, month, year);
    setSlip(data);
    setLoading(false);
    setShowAmounts(false);
  }, [profile, tenant, month, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const changeMonth = (delta: number) => {
    let m = month + delta, y = year;
    if (m > 11) { m = 0; y++; } if (m < 0) { m = 11; y--; }
    setMonth(m); setYear(y);
  };

  const handleShare = async () => {
    if (!slip || !showAmounts) return;
    const breakdown = parseBreakdown(slip);
    const text = [
      `${tenant?.company_name || 'Company'} — Payslip`,
      `Month: ${monthLabel(month, year)}`,
      `Employee: ${slip.emp_name}`,
      `Department: ${slip.department || '—'}`,
      `Days Worked: ${slip.work_days}/${slip.total_work_days}`,
      '',
      '=== EARNINGS ===',
      ...(breakdown.earnings || []).map((e: any) => `${e.name}: ${fmt(e.amount)}`),
      `Total Earnings: ${fmt(slip.gross_earnings)}`,
      '',
      '=== DEDUCTIONS ===',
      ...(breakdown.deductions || []).map((d: any) => `${d.name}: ${fmt(d.amount)}`),
      slip.advance_deduction > 0 ? `Advance Recovery: ${fmt(slip.advance_deduction)}` : '',
      `Total Deductions: ${fmt(slip.total_deductions + slip.advance_deduction)}`,
      '',
      `NET PAY: ${fmt(slip.net_pay)}`,
    ].filter(Boolean).join('\n');

    await Share.share({ message: text, title: `Payslip - ${monthLabel(month, year)}` });
  };

  const parseBreakdown = (s: any) => {
    try { return typeof s.breakdown === 'string' ? JSON.parse(s.breakdown) : (s.breakdown || {}); }
    catch { return { earnings: [], deductions: [] }; }
  };

  const breakdown = slip ? parseBreakdown(slip) : { earnings: [], deductions: [] };

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>My Payslips</Text>
          <Text style={s.subtitle}>{monthLabel(month, year)}</Text>
        </View>
        {slip && (
          <TouchableOpacity style={s.shareBtn} onPress={handleShare} disabled={!showAmounts}>
            <Ionicons name="share-outline" size={18} color={showAmounts ? '#fff' : '#fff'} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Month selector */}
        <View style={s.monthRow}>
          <TouchableOpacity style={s.navBtn} onPress={() => changeMonth(-1)}>
            <Ionicons name="chevron-back" size={20} color={C.primary} />
          </TouchableOpacity>
          <Text style={s.monthText}>{monthLabel(month, year)}</Text>
          <TouchableOpacity style={s.navBtn} onPress={() => changeMonth(1)}>
            <Ionicons name="chevron-forward" size={20} color={C.primary} />
          </TouchableOpacity>
          {slip && (
            <TouchableOpacity style={[s.revealBtn, showAmounts && s.revealActive]} onPress={() => setShowAmounts((v) => !v)}>
              <Ionicons name={showAmounts ? 'eye-off-outline' : 'eye-outline'} size={15} color={showAmounts ? '#fff' : C.primary} />
              <Text style={[s.revealText, showAmounts && { color: '#fff' }]}>
                {showAmounts ? 'Hide' : 'Reveal'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={s.loadingBox}>
            <ActivityIndicator color={C.primary} size="large" />
            <Text style={s.loadingText}>Loading payslip…</Text>
          </View>
        ) : !slip ? (
          <View style={s.emptyCard}>
            <Ionicons name="document-outline" size={44} color={C.muted} />
            <Text style={s.emptyTitle}>No payslip available</Text>
            <Text style={s.emptyText}>No payroll has been processed for {monthLabel(month, year)}.</Text>
          </View>
        ) : (
          <>
            {/* Privacy notice */}
            {!showAmounts && (
              <View style={s.privacyBanner}>
                <Ionicons name="lock-closed-outline" size={14} color={C.warning} />
                <Text style={s.privacyText}>
                  Salary amounts are hidden for privacy. Tap <Text style={{ fontWeight: '700' }}>Reveal</Text> to view.
                </Text>
              </View>
            )}

            {/* Company info */}
            <View style={s.slipHeader}>
              <View style={s.companyBlock}>
                <Text style={s.companyName}>{tenant?.company_name || 'Company'}</Text>
                <Text style={s.slipPeriod}>Payslip for {monthLabel(month, year)}</Text>
              </View>
              <View style={[s.netPayBadge, showAmounts ? {} : s.netPayMasked]}>
                <Text style={s.netPayLabel}>Net Pay</Text>
                <Text style={s.netPayValue}>
                  {showAmounts ? fmt(slip.net_pay) : '₹ ••••••'}
                </Text>
              </View>
            </View>

            {/* Employee info */}
            <View style={s.empInfo}>
              {[
                { label: 'Name', value: slip.emp_name },
                { label: 'Department', value: slip.department || '—' },
                { label: 'Designation', value: slip.designation || '—' },
                { label: 'Days Worked', value: `${slip.work_days} / ${slip.total_work_days}` },
              ].map((item) => (
                <View key={item.label} style={s.empInfoRow}>
                  <Text style={s.empInfoLabel}>{item.label}</Text>
                  <Text style={s.empInfoValue}>{item.value}</Text>
                </View>
              ))}
            </View>

            {/* Earnings section */}
            <View style={s.section}>
              <View style={[s.sectionHeader, { backgroundColor: '#F0FDF4' }]}>
                <Ionicons name="trending-up-outline" size={15} color={C.success} />
                <Text style={[s.sectionTitle, { color: C.success }]}>Earnings</Text>
              </View>
              {(breakdown.earnings || []).map((e: any, i: number) => (
                <PayslipRow key={i} label={e.name} value={e.amount} show={showAmounts} />
              ))}
              <PayslipRow label="Total Earnings" value={slip.gross_earnings} show={showAmounts} bold />
            </View>

            {/* Deductions section */}
            <View style={s.section}>
              <View style={[s.sectionHeader, { backgroundColor: '#FEF2F2' }]}>
                <Ionicons name="trending-down-outline" size={15} color={C.danger} />
                <Text style={[s.sectionTitle, { color: C.danger }]}>Deductions</Text>
              </View>
              {(breakdown.deductions || []).map((d: any, i: number) => (
                <PayslipRow key={i} label={d.name} value={d.amount} show={showAmounts} />
              ))}
              {slip.advance_deduction > 0 && (
                <PayslipRow label="Advance/Loan Recovery" value={slip.advance_deduction} show={showAmounts} />
              )}
              <PayslipRow
                label="Total Deductions"
                value={slip.total_deductions + slip.advance_deduction}
                show={showAmounts}
                bold
              />
            </View>

            {/* Net Pay */}
            <View style={s.netPaySection}>
              <Text style={s.netPaySectionLabel}>NET PAY</Text>
              <Text style={[s.netPaySectionValue, { color: showAmounts ? C.success : C.muted }]}>
                {showAmounts ? fmt(slip.net_pay) : '₹ ••••••'}
              </Text>
            </View>
          </>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F3FF' },
  scroll: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, backgroundColor: '#F5F3FF',
  },
  title: { fontSize: 22, fontWeight: '800', color: C.text },
  subtitle: { fontSize: 13, color: C.muted, marginTop: 2 },
  shareBtn: {
    backgroundColor: C.primary, width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  monthRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface,
    marginBottom: 1,
  },
  navBtn: { padding: 6, borderRadius: 8, backgroundColor: '#F1F5F9' },
  monthText: { flex: 1, fontSize: 15, fontWeight: '700', color: C.text, textAlign: 'center' },
  revealBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1.5, borderColor: C.primary,
  },
  revealActive: { backgroundColor: C.primary, borderColor: C.primary },
  revealText: { fontSize: 13, fontWeight: '600', color: C.primary },
  loadingBox: { padding: 60, alignItems: 'center', gap: 12 },
  loadingText: { color: C.muted, fontSize: 13 },
  emptyCard: {
    margin: 16, backgroundColor: C.surface, borderRadius: 16,
    padding: 48, alignItems: 'center', gap: 8,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
  privacyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 0,
    backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12,
  },
  privacyText: { flex: 1, fontSize: 12, color: C.warning },
  slipHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: 16, marginTop: 12, backgroundColor: C.surface,
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  companyBlock: { gap: 4 },
  companyName: { fontSize: 16, fontWeight: '800', color: C.text },
  slipPeriod: { fontSize: 12, color: C.muted },
  netPayBadge: {
    alignItems: 'center', backgroundColor: '#F0FDF4',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
  },
  netPayMasked: { backgroundColor: '#F1F5F9' },
  netPayLabel: { fontSize: 10, color: C.muted, fontWeight: '600' },
  netPayValue: { fontSize: 18, fontWeight: '800', color: C.success },
  empInfo: {
    marginHorizontal: 16, marginTop: 10, backgroundColor: C.surface,
    borderRadius: 16, padding: 16, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  empInfoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  empInfoLabel: { fontSize: 13, color: C.muted },
  empInfoValue: { fontSize: 13, fontWeight: '600', color: C.text },
  section: {
    marginHorizontal: 16, marginTop: 10, backgroundColor: C.surface,
    borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700' },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F8FAFC',
  },
  totalRow: { backgroundColor: '#F8FAFC' },
  rowLabel: { fontSize: 13, color: C.text },
  masked: { fontSize: 13, color: C.muted, fontFamily: 'monospace', letterSpacing: 2 },
  amtText: { fontSize: 13, fontWeight: '600', color: C.text },
  netPaySection: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: 16, marginTop: 10, marginBottom: 16,
    backgroundColor: '#1E293B', borderRadius: 16, padding: 20,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, elevation: 6,
  },
  netPaySectionLabel: { fontSize: 16, fontWeight: '800', color: '#fff' },
  netPaySectionValue: { fontSize: 22, fontWeight: '900' },
});
