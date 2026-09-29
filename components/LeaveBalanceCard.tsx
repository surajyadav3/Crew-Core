import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors as C } from '@/constants/Colors';

export type EarnedBalance = {
  balance: number;
  allocated: number;
  used: number;
  accrualDays: number;
};

/** Picks the Earned Leave row out of fetchMyLeaveBalances()'s result. */
export function pickEarnedBalance(balances: any[]): EarnedBalance {
  const row = balances.find((b) => /earned/i.test(b.leave_type?.name || ''))
    || balances.find((b) => b.leave_type?.accrual_frequency === 'monthly');
  return {
    balance: Number(row?.balance || 0),
    allocated: Number(row?.allocated || 0),
    used: Number(row?.used || 0),
    accrualDays: Number(row?.leave_type?.accrual_days || 1.5),
  };
}

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * "Leave Wallet" — just the employee's Earned Leave + Comp Off balances and
 * the monthly carry-forward, shared by the Home and Leaves screens.
 */
export default function LeaveBalanceCard({
  earned, compOff, onPress,
}: { earned: EarnedBalance; compOff: number; onPress?: () => void }) {
  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={s.outer} onPress={onPress} activeOpacity={0.9}>
      <LinearGradient colors={[C.primary, C.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.card}>
        <View style={s.decor} />
        <View style={s.headRow}>
          <View style={s.headIcon}><Ionicons name="wallet-outline" size={16} color="#fff" /></View>
          <Text style={s.title}>My Leave Wallet</Text>
          {onPress && <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />}
        </View>

        <View style={s.tiles}>
          <View style={s.tile}>
            <Text style={s.tileLabel}>EARNED LEAVE</Text>
            <View style={s.valueRow}>
              <Text style={[s.value, earned.balance < 0 && { color: '#FECACA' }]}>{fmtDays(earned.balance)}</Text>
              <Text style={s.unit}>{Math.abs(earned.balance) === 1 ? 'day' : 'days'}</Text>
            </View>
          </View>
          <View style={s.tile}>
            <Text style={s.tileLabel}>COMP OFF</Text>
            <View style={s.valueRow}>
              <Text style={s.value}>{fmtDays(compOff)}</Text>
              <Text style={s.unit}>{compOff === 1 ? 'day' : 'days'}</Text>
            </View>
          </View>
        </View>

        <Text style={s.carryForward}>Carry forward {fmtDays(earned.accrualDays)} days</Text>
      </LinearGradient>
    </Wrapper>
  );
}

const s = StyleSheet.create({
  outer: {
    marginHorizontal: 16, marginBottom: 10, borderRadius: 20,
    shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 14, elevation: 6,
  },
  card: { borderRadius: 20, padding: 16, overflow: 'hidden' },
  decor: {
    position: 'absolute', top: -50, right: -40, width: 150, height: 150, borderRadius: 75,
    backgroundColor: '#fff', opacity: 0.08,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  headIcon: {
    width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 15, fontWeight: '800', color: '#fff' },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, padding: 12 },
  tileLabel: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.75)', letterSpacing: 0.8 },
  valueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 4 },
  value: { fontSize: 30, fontWeight: '900', color: '#fff', lineHeight: 34 },
  unit: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.8)', marginBottom: 4 },
  carryForward: { fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 10, textAlign: 'center' },
});
