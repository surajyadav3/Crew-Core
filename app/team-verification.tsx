import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { listTeamVerificationRequests, reviewVerificationRequest, FIELD_GROUP_LABEL, type FieldGroup } from '@/services/verificationRequestService';
import { showToast } from '@/components/Toast';
import { fmtDate } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

/**
 * Bank / PAN / Aadhar verification requests from the people this user can
 * review — their direct reports as reporting manager, or everyone as HR.
 * Mirrors the website's VerificationRequestsPage; approval runs through the
 * review_verification_request RPC, which re-checks who may review.
 */
const FIELD_LABELS: Record<string, string> = {
  bank_acc: 'Account No.', bank_name: 'Bank', ifsc_code: 'IFSC', pan: 'PAN', aadhar: 'Aadhar',
};
const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  Pending: { color: C.amber, bg: C.amberBg },
  Approved: { color: C.success, bg: C.successBg },
  Rejected: { color: C.danger, bg: C.dangerBg },
};

const personName = (p: any) => [p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ').toUpperCase() || 'EMPLOYEE';

export default function TeamVerificationScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await listTeamVerificationRequests(profile.id);
    if (error) { showToast(error.message || 'Could not load verification requests.', 'error'); return; }
    setRequests(data);
  }, [profile]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const review = (req: any, approve: boolean) => {
    const label = FIELD_GROUP_LABEL[req.field_group as FieldGroup];
    Alert.alert(
      approve ? `Approve ${label}?` : `Reject ${label}?`,
      approve
        ? `${personName(req.profile)}'s new ${label} will be saved and marked Verified.`
        : `${personName(req.profile)}'s ${label} will stay as it was.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: approve ? 'Approve' : 'Reject',
          style: approve ? 'default' : 'destructive',
          onPress: async () => {
            if (!profile) return;
            setBusyId(req.id);
            const { error } = await reviewVerificationRequest(req, approve, profile.id);
            setBusyId(null);
            if (error) { showToast(error.message, 'error'); return; }
            showToast(approve ? `${label} approved and verified.` : `${label} change rejected.`, 'success');
            fetchData();
          },
        },
      ],
    );
  };

  const pending = requests.filter((r) => r.status === 'Pending');
  const reviewed = requests.filter((r) => r.status !== 'Pending').slice(0, 20);

  const renderValues = (values: Record<string, string> | null) => (
    <View style={{ gap: 2 }}>
      {Object.entries(values || {}).map(([k, v]) => (
        <Text key={k} style={s.valueText}><Text style={s.valueKey}>{FIELD_LABELS[k] || k}: </Text>{v || '—'}</Text>
      ))}
      {!values || Object.keys(values).length === 0 ? <Text style={s.valueText}>—</Text> : null}
    </View>
  );

  const renderCard = (req: any) => {
    const st = STATUS_STYLE[req.status] || STATUS_STYLE.Pending;
    const subtitle = [req.profile?.designation || req.profile?.department, req.profile?.outlet_location].filter(Boolean).join(' · ');
    return (
      <View key={req.id} style={s.card}>
        <View style={s.cardTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.name} numberOfLines={1}>{personName(req.profile)}</Text>
            {!!subtitle && <Text style={s.meta} numberOfLines={1}>{subtitle}</Text>}
          </View>
          <View style={[s.pill, { backgroundColor: st.bg }]}><Text style={[s.pillText, { color: st.color }]}>{req.status}</Text></View>
        </View>
        <Text style={s.group}>{FIELD_GROUP_LABEL[req.field_group as FieldGroup]} · requested {fmtDate(req.created_at)}</Text>
        <View style={s.diff}>
          <View style={s.diffCol}>
            <Text style={s.diffLabel}>Current</Text>
            {renderValues(req.old_value)}
          </View>
          <Ionicons name="arrow-forward" size={16} color={C.muted} style={{ marginTop: 18 }} />
          <View style={s.diffCol}>
            <Text style={[s.diffLabel, { color: C.primary }]}>New</Text>
            {renderValues(req.new_value)}
          </View>
        </View>
        {req.status === 'Pending' && (
          <View style={s.actions}>
            <TouchableOpacity style={[s.btn, s.rejectBtn]} disabled={busyId === req.id} onPress={() => review(req, false)} activeOpacity={0.85}>
              <Ionicons name="close" size={16} color={C.danger} />
              <Text style={[s.btnText, { color: C.danger }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.approveBtn]} disabled={busyId === req.id} onPress={() => review(req, true)} activeOpacity={0.85}>
              {busyId === req.id ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                  <Text style={[s.btnText, { color: '#fff' }]}>Approve</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Team Verification</Text>
          <Text style={s.subtitle}>Bank, PAN & Aadhar changes from your team</Text>
        </View>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : (
          <>
            <Text style={s.section}>Awaiting your review ({pending.length})</Text>
            {pending.length === 0
              ? <View style={s.emptyCard}><Text style={s.emptyText}>No pending verification requests.</Text></View>
              : pending.map(renderCard)}
            {reviewed.length > 0 && (
              <>
                <Text style={s.section}>Recently reviewed</Text>
                {reviewed.map(renderCard)}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.dark },
  scroll: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, backgroundColor: C.dark },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '900', color: '#fff' },
  subtitle: { fontSize: 12.5, color: 'rgba(255,255,255,0.4)', marginTop: 1 },
  loadingBox: { padding: 60, alignItems: 'center' },
  section: { fontSize: 11.5, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 20, marginTop: 18, marginBottom: 8 },
  emptyCard: { marginHorizontal: 14, backgroundColor: C.surface, borderRadius: 18, padding: 18 },
  emptyText: { fontSize: 13, color: C.muted },
  card: { marginHorizontal: 14, marginBottom: 10, backgroundColor: C.surface, borderRadius: 18, padding: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 14, fontWeight: '800', color: C.text },
  meta: { fontSize: 11.5, color: C.muted, marginTop: 1 },
  pill: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
  group: { fontSize: 12, fontWeight: '700', color: C.primary, marginTop: 8 },
  diff: { flexDirection: 'row', gap: 8, marginTop: 8, backgroundColor: C.bg, borderRadius: 12, padding: 10 },
  diffCol: { flex: 1, minWidth: 0 },
  diffLabel: { fontSize: 10.5, fontWeight: '800', color: C.muted, textTransform: 'uppercase', marginBottom: 4 },
  valueText: { fontSize: 12, color: C.text },
  valueKey: { color: C.muted, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 11 },
  rejectBtn: { backgroundColor: C.dangerBg },
  approveBtn: { backgroundColor: C.success },
  btnText: { fontSize: 13.5, fontWeight: '800' },
});
