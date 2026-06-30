import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Share, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { fetchMyPayslip } from '@/services/payrollService';
import { fmt, monthLabel } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

function Amt({ value, show }: { value: number; show: boolean }) {
  if (!show) return <Text style={s.masked}>₹ ••••••</Text>;
  return <Text style={s.amtText}>{fmt(value)}</Text>;
}

function PayslipRow({ label, value, show, bold, isTotal }: {
  label: string; value: number; show: boolean; bold?: boolean; isTotal?: boolean;
}) {
  return (
    <View style={[s.psRow, isTotal && s.psTotalRow]}>
      <Text style={[s.psLabel, (bold || isTotal) && { fontWeight: '700', color: isTotal ? C.success : C.text }]}>
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
  const revealAnim = React.useRef(new Animated.Value(0)).current;

  const fetchData = useCallback(async () => {
    if (!profile || !tenant) return;
    setLoading(true);
    const { data } = await fetchMyPayslip(tenant.id, profile.id, month, year);
    setSlip(data);
    setLoading(false);
    setShowAmounts(false);
  }, [profile, tenant, month, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleReveal = () => {
    const next = !showAmounts;
    setShowAmounts(next);
    Animated.spring(revealAnim, { toValue: next ? 1 : 0, useNativeDriver: true, damping: 14, stiffness: 200 }).start();
  };

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
      '', '=== EARNINGS ===',
      ...(breakdown.earnings || []).map((e: any) => `${e.name}: ${fmt(e.amount)}`),
      `Total Earnings: ${fmt(slip.gross_earnings)}`,
      '', '=== DEDUCTIONS ===',
      ...(breakdown.deductions || []).map((d: any) => `${d.name}: ${fmt(d.amount)}`),
      slip.advance_deduction > 0 ? `Advance Recovery: ${fmt(slip.advance_deduction)}` : '',
      `Total Deductions: ${fmt(slip.total_deductions + slip.advance_deduction)}`,
      '', `NET PAY: ${fmt(slip.net_pay)}`,
    ].filter(Boolean).join('\n');
    await Share.share({ message: text, title: `Payslip - ${monthLabel(month, year)}` });
  };

  const parseBreakdown = (s: any) => {
    try { return typeof s.breakdown === 'string' ? JSON.parse(s.breakdown) : (s.breakdown || {}); }
    catch { return { earnings: [], deductions: [] }; }
  };

  const breakdown = slip ? parseBreakdown(slip) : { earnings: [], deductions: [] };
  const revealScale = revealAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>My Payslips</Text>
          <Text style={s.subtitle}>{monthLabel(month, year)}</Text>
        </View>
        {slip && (
          <TouchableOpacity
            style={[s.shareBtn, !showAmounts && { opacity: 0.4 }]}
            onPress={handleShare}
            disabled={!showAmounts}
            activeOpacity={0.85}
          >
            <Ionicons name="share-outline" size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}>

        {/* Month selector */}
        <View style={s.monthSelector}>
          <TouchableOpacity style={s.navBtn} onPress={() => changeMonth(-1)} activeOpacity={0.8}>
            <Ionicons name="chevron-back" size={18} color={C.primary} />
          </TouchableOpacity>
          <Text style={s.monthText}>{monthLabel(month, year)}</Text>
          <TouchableOpacity style={s.navBtn} onPress={() => changeMonth(1)} activeOpacity={0.8}>
            <Ionicons name="chevron-forward" size={18} color={C.primary} />
          </TouchableOpacity>

          {slip && (
            <TouchableOpacity
              style={[s.revealBtn, showAmounts && s.revealActive]}
              onPress={toggleReveal}
              activeOpacity={0.85}
            >
              <Ionicons
                name={showAmounts ? 'eye-off-outline' : 'eye-outline'}
                size={15}
                color={showAmounts ? '#fff' : C.primary}
              />
              <Text style={[s.revealText, showAmounts && { color: '#fff' }]}>
                {showAmounts ? 'Hide' : 'Reveal'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={s.loadingBox}>
            <View style={s.loadingIconWrap}>
              <Ionicons name="document-text-outline" size={28} color={C.primary} />
            </View>
            <ActivityIndicator color={C.primary} size="large" style={{ marginTop: 16 }} />
            <Text style={s.loadingText}>Loading payslip…</Text>
          </View>
        ) : !slip ? (
          <View style={s.emptyCard}>
            <View style={s.emptyIconWrap}>
              <Ionicons name="document-outline" size={36} color={C.primary} />
            </View>
            <Text style={s.emptyTitle}>No payslip available</Text>
            <Text style={s.emptyText}>No payroll processed for {monthLabel(month, year)}.</Text>
          </View>
        ) : (
          <Animated.View style={{ transform: [{ scale: revealScale }] }}>
            {/* Privacy notice */}
            {!showAmounts && (
              <View style={s.privacyBanner}>
                <Ionicons name="lock-closed" size={14} color={C.primary} />
                <Text style={s.privacyText}>
                  Salary amounts are hidden. Tap <Text style={{ fontWeight: '700', color: C.primary }}>Reveal</Text> to view.
                </Text>
              </View>
            )}

            {/* Company header + Net Pay */}
            <View style={s.slipTopCard}>
              <View style={s.companyRow}>
                <View style={s.companyInitials}>
                  <Text style={s.companyInitialsText}>
                    {(tenant?.company_name || 'C')[0].toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text style={s.companyName}>{tenant?.company_name || 'Company'}</Text>
                  <Text style={s.slipPeriod}>Payslip · {monthLabel(month, year)}</Text>
                </View>
              </View>
              <View style={s.netPayBox}>
                <Text style={s.netPayLabel}>NET PAY</Text>
                <Text style={[s.netPayValue, { color: showAmounts ? C.success : C.muted }]}>
                  {showAmounts ? fmt(slip.net_pay) : '₹ ••••'}
                </Text>
              </View>
            </View>

            {/* Employee info */}
            <View style={s.empCard}>
              <Text style={s.cardSectionTitle}>Employee Details</Text>
              {[
                { label: 'Name', value: slip.emp_name, icon: 'person-outline' as const },
                { label: 'Department', value: slip.department || '—', icon: 'briefcase-outline' as const },
                { label: 'Designation', value: slip.designation || '—', icon: 'ribbon-outline' as const },
                { label: 'Days Worked', value: `${slip.work_days} of ${slip.total_work_days}`, icon: 'calendar-outline' as const },
              ].map((item, idx, arr) => (
                <View key={item.label}>
                  <View style={s.empRow}>
                    <View style={s.empIconWrap}>
                      <Ionicons name={item.icon} size={14} color={C.primary} />
                    </View>
                    <View style={s.empInfo}>
                      <Text style={s.empLabel}>{item.label}</Text>
                      <Text style={s.empValue}>{item.value}</Text>
                    </View>
                  </View>
                  {idx < arr.length - 1 && <View style={s.divider} />}
                </View>
              ))}
            </View>

            {/* Earnings */}
            <View style={s.sectionCard}>
              <View style={[s.sectionHeader, { backgroundColor: C.successBg }]}>
                <View style={[s.sectionHeaderIcon, { backgroundColor: C.success + '30' }]}>
                  <Ionicons name="trending-up" size={14} color={C.success} />
                </View>
                <Text style={[s.sectionTitle, { color: C.success }]}>Earnings</Text>
              </View>
              {(breakdown.earnings || []).map((e: any, i: number) => (
                <PayslipRow key={i} label={e.name} value={e.amount} show={showAmounts} />
              ))}
              <PayslipRow label="Total Earnings" value={slip.gross_earnings} show={showAmounts} bold />
            </View>

            {/* Deductions */}
            <View style={s.sectionCard}>
              <View style={[s.sectionHeader, { backgroundColor: C.dangerBg }]}>
                <View style={[s.sectionHeaderIcon, { backgroundColor: C.danger + '30' }]}>
                  <Ionicons name="trending-down" size={14} color={C.danger} />
                </View>
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
                show={showAmounts} bold
              />
            </View>

            {/* Net Pay section */}
            <View style={s.netPaySection}>
              <View style={s.netPayDecor} />
              <View style={{ flex: 1 }}>
                <Text style={s.netLbl}>NET PAY</Text>
                <Text style={s.netSubtitle}>{monthLabel(month, year)}</Text>
              </View>
              <Text style={[s.netValue, { color: showAmounts ? C.success : 'rgba(255,255,255,0.3)' }]}>
                {showAmounts ? fmt(slip.net_pay) : '₹ ••••••'}
              </Text>
            </View>
          </Animated.View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.dark },
  scroll: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, backgroundColor: C.dark,
  },
  title: { fontSize: 24, fontWeight: '900', color: '#fff' },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  shareBtn: {
    backgroundColor: C.primary, width: 42, height: 42, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.4, shadowRadius: 10, elevation: 5,
  },

  // Month selector
  monthSelector: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  navBtn: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  monthText: { flex: 1, fontSize: 15, fontWeight: '700', color: C.text, textAlign: 'center' },
  revealBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.primary,
  },
  revealActive: { backgroundColor: C.primary, borderColor: C.primary },
  revealText: { fontSize: 13, fontWeight: '600', color: C.primary },

  // Loading/empty
  loadingBox: { padding: 60, alignItems: 'center' },
  loadingIconWrap: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  loadingText: { color: C.muted, fontSize: 13, marginTop: 12 },
  emptyCard: {
    margin: 16, backgroundColor: C.surface, borderRadius: 20,
    padding: 48, alignItems: 'center', gap: 10,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 22, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },

  // Privacy banner
  privacyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 14, marginTop: 12,
    backgroundColor: C.primaryBg, borderRadius: 12, padding: 12,
    borderLeftWidth: 3, borderLeftColor: C.primary,
  },
  privacyText: { flex: 1, fontSize: 12.5, color: C.muted },

  // Slip header card
  slipTopCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: 14, marginTop: 12, backgroundColor: C.surface,
    borderRadius: 18, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  companyInitials: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  companyInitialsText: { fontSize: 20, fontWeight: '900', color: C.primary },
  companyName: { fontSize: 15, fontWeight: '800', color: C.text },
  slipPeriod: { fontSize: 12, color: C.muted, marginTop: 2 },
  netPayBox: {
    alignItems: 'flex-end', backgroundColor: C.successBg,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  netPayLabel: { fontSize: 9, color: C.muted, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  netPayValue: { fontSize: 18, fontWeight: '900', marginTop: 2 },

  // Employee card
  empCard: {
    marginHorizontal: 14, marginTop: 10, backgroundColor: C.surface,
    borderRadius: 18, padding: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cardSectionTitle: { fontSize: 11, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  empRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  empIconWrap: {
    width: 30, height: 30, borderRadius: 9, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  empInfo: { flex: 1 },
  empLabel: { fontSize: 11, color: C.muted, marginBottom: 2 },
  empValue: { fontSize: 13.5, fontWeight: '600', color: C.text },
  divider: { height: 1, backgroundColor: C.border },

  // Payslip section card
  sectionCard: {
    marginHorizontal: 14, marginTop: 10, backgroundColor: C.surface,
    borderRadius: 18, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  sectionHeaderIcon: {
    width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { fontSize: 13, fontWeight: '800' },
  psRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#F8FAFC',
  },
  psTotalRow: { backgroundColor: '#F8FAFC' },
  psLabel: { fontSize: 13, color: C.text },
  masked: { fontSize: 13, color: C.muted, letterSpacing: 2 },
  amtText: { fontSize: 13, fontWeight: '600', color: C.text },

  // Net pay section
  netPaySection: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 14, marginTop: 10, marginBottom: 10,
    backgroundColor: C.dark, borderRadius: 20, padding: 22,
    shadowColor: C.dark, shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
    overflow: 'hidden',
  },
  netPayDecor: {
    position: 'absolute', right: -30, top: -30,
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: C.primary, opacity: 0.15,
  },
  netLbl: { fontSize: 16, fontWeight: '900', color: '#fff' },
  netSubtitle: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  netValue: { fontSize: 26, fontWeight: '900' },
});
