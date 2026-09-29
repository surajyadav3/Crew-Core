import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Modal,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { submitRegularizeRequest } from '@/services/attendanceService';
import { showToast } from '@/components/Toast';
import { todayStr, fmtDate, regularizeMinDate, regularizeWindowLabel } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Regularize request for one fixed date — opened from the Attendance calendar
 * when the employee taps a Late / Mispunch / Absent day, so the date is already
 * known and only the corrected times + reason are asked for. The Requests tab
 * keeps its own free-date form for everything else.
 */
export default function RegularizeRequestModal({
  visible, date, defaultIn, defaultOut, onClose, onSubmitted,
}: {
  visible: boolean;
  date: string;
  defaultIn?: string;
  defaultOut?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const { profile, tenant } = useAuth();
  const [clockInTime, setClockInTime] = useState('');
  const [clockOutTime, setClockOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setClockInTime((defaultIn || '').slice(0, 5));
    setClockOutTime((defaultOut || '').slice(0, 5));
    setReason('');
  }, [visible, date, defaultIn, defaultOut]);

  const handleSubmit = async () => {
    if (date > todayStr()) { showToast('Cannot regularize a future date.', 'error'); return; }
    if (date < regularizeMinDate(tenant)) { showToast(`Regularization can only be requested for ${regularizeWindowLabel(tenant)}.`, 'error'); return; }
    if (!TIME_RE.test(clockInTime)) { showToast('Clock-in time must be in HH:MM (24h) format.', 'error'); return; }
    if (!TIME_RE.test(clockOutTime)) { showToast('Clock-out time must be in HH:MM (24h) format.', 'error'); return; }
    if (clockInTime >= clockOutTime) { showToast('Clock-out must be after clock-in.', 'error'); return; }
    if (!reason.trim()) { showToast('Reason is required.', 'error'); return; }
    if (!tenant || !profile) { showToast('You do not belong to any workspace.', 'error'); return; }
    setSaving(true);
    try {
      const { error, tier } = await submitRegularizeRequest(tenant.id, profile.id, {
        date, clockInTime, clockOutTime, reason: reason.trim(),
      });
      if (error) throw error;
      const msg = tier === 'self' ? 'Auto-approved! Attendance updated.' : tier === 'manager' ? 'Sent to your manager for approval — HR gets a copy.' : 'Sent to HR for approval.';
      showToast(msg, tier === 'self' ? 'success' : 'info');
      onClose();
      onSubmitted?.();
    } catch (err: any) {
      showToast('Failed: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.card}>
          <View style={s.handle} />
          <View style={s.header}>
            <View style={s.titleRow}>
              <View style={s.iconWrap}><Ionicons name="calendar-outline" size={16} color={C.primary} /></View>
              <Text style={s.title}>Regularize Attendance</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={20} color={C.muted} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={s.infoBanner}>
              <Ionicons name="information-circle-outline" size={14} color={C.primary} />
              <Text style={s.infoText}>Enter your correct punch-in and punch-out times. It goes to your manager for approval, and HR gets a copy (either can approve).</Text>
            </View>
            <View style={s.formGroup}>
              <Text style={s.label}>Date</Text>
              <View style={[s.input, s.readOnly]}><Text style={s.readOnlyText}>{fmtDate(date)}</Text></View>
            </View>
            <View style={s.row}>
              <View style={[s.formGroup, { flex: 1 }]}>
                <Text style={s.label}>Correct Clock-In</Text>
                <TextInput style={s.input} value={clockInTime} onChangeText={setClockInTime}
                  placeholder="HH:MM" placeholderTextColor={C.muted} keyboardType="numbers-and-punctuation" maxLength={5} />
              </View>
              <View style={[s.formGroup, { flex: 1 }]}>
                <Text style={s.label}>Correct Clock-Out</Text>
                <TextInput style={s.input} value={clockOutTime} onChangeText={setClockOutTime}
                  placeholder="HH:MM" placeholderTextColor={C.muted} keyboardType="numbers-and-punctuation" maxLength={5} />
              </View>
            </View>
            <View style={s.formGroup}>
              <Text style={s.label}>Reason</Text>
              <TextInput style={[s.input, s.textarea]} value={reason} onChangeText={setReason}
                placeholder="e.g. Forgot to punch in on the biometric…" placeholderTextColor={C.muted}
                multiline numberOfLines={3} />
            </View>
            <View style={s.footer}>
              <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.submitBtn, saving && { opacity: 0.6 }]} onPress={handleSubmit} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitText}>Submit</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  card: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '90%' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: C.text },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary,
    borderRadius: 12, padding: 12, marginBottom: 14,
  },
  infoText: { flex: 1, fontSize: 12, color: C.primary, lineHeight: 17 },
  formGroup: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  input: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text, backgroundColor: '#FAFAFA',
  },
  readOnly: { backgroundColor: C.bg },
  readOnlyText: { fontSize: 14, color: C.muted },
  textarea: { height: 88, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 8, paddingBottom: 12 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: C.muted },
  submitBtn: {
    flex: 1, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
