import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { listPolicies, createPolicy, markPolicyRead, listPolicyReadCounts, listPolicyReads } from '@/services/policyService';
import { listAnnouncements, createAnnouncement } from '@/services/announcementService';
import { listMyNotifications, markNotificationRead } from '@/services/notificationService';
import { showToast } from '@/components/Toast';
import { fmtDate, fmtDateTime } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

type Segment = 'announcements' | 'policies' | 'alerts';

const SEGMENTS: { key: Segment; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'announcements', label: 'Announcements', icon: 'megaphone-outline' },
  { key: 'policies', label: 'Policies', icon: 'document-text-outline' },
  { key: 'alerts', label: 'Alerts', icon: 'notifications-outline' },
];

const NOTIF_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  policy: 'document-text-outline',
  announcement: 'megaphone-outline',
  leave_approved: 'checkmark-circle-outline',
  leave_rejected: 'close-circle-outline',
  clock_in: 'log-in-outline',
  clock_out: 'log-out-outline',
  policy_read: 'eye-outline',
};

export default function NoticesScreen() {
  const { profile, tenant } = useAuth();
  const canPost = profile?.role === 'admin' || profile?.role === 'superadmin';

  const [segment, setSegment] = useState<Segment>('announcements');
  const [policies, setPolicies] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });
  const [saving, setSaving] = useState(false);
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);
  const [readCounts, setReadCounts] = useState<Record<string, number>>({});
  const [readLists, setReadLists] = useState<Record<string, any[]>>({});

  const fetchAll = useCallback(async () => {
    if (!tenant || !profile) return;
    setLoading(true);
    const [polRes, annRes, notifRes] = await Promise.all([
      listPolicies(tenant.id),
      listAnnouncements(tenant.id),
      listMyNotifications(profile.id),
    ]);
    if (polRes.error) {
      showToast(polRes.error.message, 'error');
    } else {
      setPolicies(polRes.data);
      const ownIds = polRes.data.filter((p: any) => p.created_by === profile.id).map((p: any) => p.id);
      if (ownIds.length > 0) {
        const { counts } = await listPolicyReadCounts(ownIds);
        setReadCounts(counts);
      }
    }
    if (annRes.error) showToast(annRes.error.message, 'error'); else setAnnouncements(annRes.data);
    if (notifRes.error) showToast(notifRes.error.message, 'error'); else setNotifications(notifRes.data);
    setLoading(false);
  }, [tenant, profile]);

  const handleOpenPolicy = async (item: any) => {
    if (!profile || !tenant) return;
    if (item.created_by === profile.id) {
      const next = expandedPolicyId === item.id ? null : item.id;
      setExpandedPolicyId(next);
      if (next && !readLists[item.id]) {
        const { data } = await listPolicyReads(item.id);
        setReadLists((prev) => ({ ...prev, [item.id]: data }));
      }
      return;
    }
    markPolicyRead(item.id, profile.id, tenant.id);
  };

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.body.trim()) { showToast('Please fill in both fields.', 'error'); return; }
    if (!tenant || !profile) return;
    setSaving(true);
    try {
      const { error } = segment === 'policies'
        ? await createPolicy(tenant.id, profile.id, form.title.trim(), form.body.trim())
        : await createAnnouncement(tenant.id, profile.id, form.title.trim(), form.body.trim());
      if (error) {
        showToast(error.message || 'Failed to post.', 'error');
      } else {
        showToast(segment === 'policies' ? 'Policy rolled out to everyone.' : 'Announcement sent to everyone.', 'success');
        setShowModal(false);
        setForm({ title: '', body: '' });
        fetchAll();
      }
    } catch (err: any) {
      showToast(err.message || 'Something went wrong.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenNotification = async (n: any) => {
    if (!n.read) {
      await markNotificationRead(n.id);
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
  };

  const list = segment === 'policies' ? policies : segment === 'announcements' ? announcements : notifications;
  const emptyLabel = segment === 'policies' ? 'policies' : segment === 'announcements' ? 'announcements' : 'notifications';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>Notices</Text>
          <Text style={s.subtitle}>Policies, announcements & alerts</Text>
        </View>
        {canPost && segment !== 'alerts' && (
          <TouchableOpacity style={s.addBtn} onPress={() => setShowModal(true)} activeOpacity={0.85}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={s.addBtnText}>New</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={s.segmentRow}>
        {SEGMENTS.map((seg) => (
          <TouchableOpacity
            key={seg.key}
            style={[s.segmentBtn, segment === seg.key && s.segmentBtnActive]}
            onPress={() => setSegment(seg.key)}
            activeOpacity={0.8}
          >
            <Ionicons name={seg.icon} size={14} color={segment === seg.key ? '#fff' : C.muted} />
            <Text style={[s.segmentText, segment === seg.key && s.segmentTextActive]}>{seg.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}>
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : list.length === 0 ? (
          <View style={s.emptyCard}>
            <View style={s.emptyIconWrap}>
              <Ionicons name={SEGMENTS.find((seg) => seg.key === segment)!.icon} size={36} color={C.primary} />
            </View>
            <Text style={s.emptyTitle}>No {emptyLabel} yet</Text>
            {canPost && segment !== 'alerts' && (
              <Text style={s.emptyText}>Tap "New" above to roll one out to everyone.</Text>
            )}
          </View>
        ) : segment === 'alerts' ? (
          <View style={s.list}>
            {notifications.map((n) => (
              <TouchableOpacity key={n.id} style={[s.notifCard, !n.read && s.notifCardUnread]} onPress={() => handleOpenNotification(n)} activeOpacity={0.85}>
                <View style={[s.notifIconWrap, !n.read && { backgroundColor: C.primaryBg }]}>
                  <Ionicons name={NOTIF_ICON[n.type] || 'notifications-outline'} size={18} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.notifTitle} numberOfLines={1}>{n.title}</Text>
                  {!!n.body && <Text style={s.notifBody} numberOfLines={2}>{n.body}</Text>}
                  <Text style={s.notifTime}>{fmtDate(n.created_at)}</Text>
                </View>
                {!n.read && <View style={s.unreadDot} />}
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={s.list}>
            {list.map((item) => {
              const isOwnPolicy = segment === 'policies' && item.created_by === profile?.id;
              const viewers = (readLists[item.id] || []).filter((r: any) => r.profile_id !== profile?.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={s.noticeCard}
                  activeOpacity={segment === 'policies' ? 0.85 : 1}
                  disabled={segment !== 'policies'}
                  onPress={() => handleOpenPolicy(item)}
                >
                  <View style={s.noticeTop}>
                    <View style={s.noticeIconWrap}>
                      <Ionicons name={segment === 'policies' ? 'document-text' : 'megaphone'} size={16} color={C.primary} />
                    </View>
                    <Text style={s.noticeTitle} numberOfLines={2}>{item.title}</Text>
                  </View>
                  <Text style={s.noticeBody}>{item.body ?? item.message}</Text>
                  <Text style={s.noticeTime}>Posted {fmtDate(item.created_at)}</Text>
                  {isOwnPolicy && (
                    <View style={s.seenByRow}>
                      <Ionicons name="eye-outline" size={13} color={C.muted} />
                      <Text style={s.seenByText}>Seen by {readCounts[item.id] ?? 0}</Text>
                    </View>
                  )}
                  {isOwnPolicy && expandedPolicyId === item.id && (
                    <View style={s.seenByList}>
                      {!readLists[item.id] ? (
                        <ActivityIndicator color={C.primary} size="small" />
                      ) : viewers.length === 0 ? (
                        <Text style={s.seenByEmpty}>No one has opened this yet.</Text>
                      ) : (
                        viewers.map((r: any) => (
                          <View key={r.profile_id} style={s.seenByItem}>
                            <Text style={s.seenByName}>{r.profile?.first_name} {r.profile?.last_name}</Text>
                            <Text style={s.seenByTime}>{fmtDateTime(r.read_at)}</Text>
                          </View>
                        ))
                      )}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={showModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <View style={s.modalTitleRow}>
                <View style={s.modalIconWrap}>
                  <Ionicons name={segment === 'policies' ? 'document-text-outline' : 'megaphone-outline'} size={18} color={C.primary} />
                </View>
                <Text style={s.modalTitle}>{segment === 'policies' ? 'New Policy' : 'New Announcement'}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Title</Text>
                <TextInput
                  style={s.inputRaw}
                  value={form.title}
                  onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
                  placeholder="e.g. Updated Leave Policy"
                  placeholderTextColor={C.muted}
                />
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Details</Text>
                <TextInput
                  style={[s.inputRaw, s.textarea]}
                  value={form.body}
                  onChangeText={(v) => setForm((f) => ({ ...f, body: v }))}
                  placeholder="Full details to share with everyone…"
                  placeholderTextColor={C.muted}
                  multiline
                  numberOfLines={5}
                />
              </View>
              <Text style={s.hint}>This will be sent as a push notification to every employee.</Text>

              <View style={s.modalFooter}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.submitBtn, saving && { opacity: 0.6 }]} onPress={handleSubmit} disabled={saving} activeOpacity={0.85}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitText}>Roll Out</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14,
    shadowColor: C.primary, shadowOpacity: 0.4, shadowRadius: 10, elevation: 5,
  },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  segmentRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.bg,
  },
  segmentBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center',
    paddingVertical: 10, borderRadius: 12, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
  },
  segmentBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  segmentText: { fontSize: 12, fontWeight: '700', color: C.muted },
  segmentTextActive: { color: '#fff' },
  loadingBox: { padding: 60, alignItems: 'center' },
  emptyCard: {
    margin: 16, backgroundColor: C.surface, borderRadius: 20,
    padding: 40, alignItems: 'center', gap: 10,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
  list: { padding: 14, gap: 12 },
  noticeCard: {
    backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 8,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  noticeTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noticeIconWrap: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  noticeTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: C.text },
  noticeBody: { fontSize: 13, color: C.muted, lineHeight: 19 },
  noticeTime: { fontSize: 11, color: '#CBD5E1' },
  seenByRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  seenByText: { fontSize: 11.5, color: C.muted, fontWeight: '600' },
  seenByList: {
    marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border, gap: 8,
  },
  seenByEmpty: { fontSize: 12, color: C.muted, fontStyle: 'italic' },
  seenByItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seenByName: { fontSize: 12.5, color: C.text, fontWeight: '600' },
  seenByTime: { fontSize: 11, color: C.muted },
  notifCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: C.surface, borderRadius: 16, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  notifCardUnread: { borderWidth: 1, borderColor: C.primaryBg },
  notifIconWrap: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: C.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  notifTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  notifBody: { fontSize: 12.5, color: C.muted, marginTop: 2, lineHeight: 18 },
  notifTime: { fontSize: 11, color: '#CBD5E1', marginTop: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary, marginTop: 4 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, maxHeight: '88%',
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: C.border,
    alignSelf: 'center', marginBottom: 16,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalIconWrap: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: C.text },
  closeBtn: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: C.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  formGroup: { marginBottom: 16 },
  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  inputRaw: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text,
    backgroundColor: '#FAFAFA',
  },
  textarea: { height: 120, textAlignVertical: 'top' },
  hint: { fontSize: 12, color: C.muted, marginBottom: 8 },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 8, paddingBottom: 12 },
  cancelBtn: {
    flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
  },
  cancelText: { fontSize: 14, fontWeight: '600', color: C.muted },
  submitBtn: {
    flex: 1, backgroundColor: C.primary, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
    shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
