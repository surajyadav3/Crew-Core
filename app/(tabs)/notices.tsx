import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import { useForegroundRefresh } from '@/hooks/useForegroundRefresh';
import {
  listPolicies, createPolicy, acknowledgePolicy, listMyPolicyAcks, logPolicyDownload, listPolicyAckCounts, listPolicyAcks,
} from '@/services/policyService';
import { downloadToDevice } from '@/lib/downloadFile';
import { listAnnouncements, createAnnouncement } from '@/services/announcementService';
import { listMyNotifications, markNotificationRead } from '@/services/notificationService';
import { showToast } from '@/components/Toast';
import { fmtDate, fmtDateTime, personName } from '@/lib/helpers';
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
  const router = useRouter();
  const { profile, tenant } = useAuth();
  const { isEnabled } = useFeatures();
  const canPost = profile?.role === 'admin' || profile?.role === 'superadmin';

  // 'alerts' isn't a toggleable feature on web (it's CrewCore's own notification
  // feed, not a sidebar item there), so isEnabled('alerts') naturally always
  // resolves true — no matching row is ever written for it.
  const visibleSegments = SEGMENTS.filter((seg) => isEnabled(seg.key));

  const [segment, setSegment] = useState<Segment>('announcements');
  // Home's "Policies" shortcut opens /notices?tab=policies.
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  useEffect(() => {
    if (tab && SEGMENTS.some((seg) => seg.key === tab)) setSegment(tab as Segment);
  }, [tab]);
  useEffect(() => {
    if (!visibleSegments.some((s) => s.key === segment) && visibleSegments.length) {
      setSegment(visibleSegments[0].key);
    }
  }, [visibleSegments.map((s) => s.key).join(',')]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });
  const [saving, setSaving] = useState(false);
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);
  const [readCounts, setReadCounts] = useState<Record<string, number>>({});
  const [readLists, setReadLists] = useState<Record<string, any[]>>({});
  // policy_id -> acknowledged_at, for this employee.
  const [myAcks, setMyAcks] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  // Independent of expandedPolicyId (which drives the "seen by" list for an
  // admin's own policy) — this toggles the description text itself, for
  // every notice, so long policy bodies don't force endless scrolling past
  // titles. Collapsed to 2 lines by default.
  const [expandedBody, setExpandedBody] = useState<Record<string, boolean>>({});

  const isImageAttachment = (name?: string, url?: string) => /\.(jpe?g|png|gif|webp|heic|heif)(\?|$)/i.test(name || url || '');

  const fetchAll = useCallback(async () => {
    if (!tenant || !profile) return;
    const [polRes, annRes, notifRes, ackRes] = await Promise.all([
      listPolicies(tenant.id),
      listAnnouncements(tenant.id),
      listMyNotifications(profile.id),
      listMyPolicyAcks(profile.id),
    ]);
    if (!ackRes.error) setMyAcks(ackRes.acks);
    if (polRes.error) {
      showToast(polRes.error.message, 'error');
    } else {
      setPolicies(polRes.data);
      // HR sees how many employees acknowledged each policy.
      if (canPost && polRes.data.length > 0) {
        const { counts } = await listPolicyAckCounts(polRes.data.map((p: any) => p.id));
        setReadCounts(counts);
      }
    }
    if (annRes.error) showToast(annRes.error.message, 'error'); else setAnnouncements(annRes.data);
    if (notifRes.error) showToast(notifRes.error.message, 'error'); else setNotifications(notifRes.data);
  }, [tenant, profile, canPost]);

  const handleOpenPolicy = async (item: any) => {
    if (!profile || !tenant || !canPost) return;
    const next = expandedPolicyId === item.id ? null : item.id;
    setExpandedPolicyId(next);
    if (next && !readLists[item.id]) {
      const { data } = await listPolicyAcks(item.id);
      setReadLists((prev) => ({ ...prev, [item.id]: data }));
    }
  };

  const handleAcknowledge = async (item: any) => {
    if (!profile || !tenant || myAcks[item.id]) return;
    setBusyId(item.id);
    const { error } = await acknowledgePolicy(item.id, profile.id, tenant.id);
    setBusyId(null);
    if (error) { showToast(error.message || 'Could not acknowledge.', 'error'); return; }
    setMyAcks((prev) => ({ ...prev, [item.id]: new Date().toISOString() }));
    showToast('Thanks — your acknowledgement has been sent to HR.', 'success');
  };

  const handleDownload = async (item: any) => {
    if (!profile || !tenant || !item.pdf_url) return;
    setBusyId(item.id);
    try {
      const result = await downloadToDevice(item.pdf_url, item.pdf_name || `${item.title}.pdf`);
      if (result === 'cancelled') return;
      logPolicyDownload(item.id, profile.id, tenant.id);
      if (result === 'saved') showToast('Policy saved to your phone.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Download failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const pendingAcks = policies.filter((p) => !myAcks[p.id]).length;

  useForegroundRefresh(fetchAll, setLoading);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

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
    if (!n.is_read) {
      await markNotificationRead(n.id);
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    }
    if (n.type === 'verification_request_submitted') router.push('/team-verification' as any);
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
        {visibleSegments.map((seg) => (
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

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>
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
              <TouchableOpacity key={n.id} style={[s.notifCard, !n.is_read && s.notifCardUnread]} onPress={() => handleOpenNotification(n)} activeOpacity={0.85}>
                <View style={[s.notifIconWrap, !n.is_read && { backgroundColor: C.primaryBg }]}>
                  <Ionicons name={NOTIF_ICON[n.type] || 'notifications-outline'} size={18} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.notifTitle} numberOfLines={1}>{n.title}</Text>
                  {!!n.body && <Text style={s.notifBody} numberOfLines={2}>{n.body}</Text>}
                  <Text style={s.notifTime}>{fmtDate(n.created_at)}</Text>
                </View>
                {!n.is_read && <View style={s.unreadDot} />}
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={s.list}>
            {segment === 'policies' && pendingAcks > 0 && (
              <View style={s.pendingBanner}>
                <Ionicons name="alert-circle-outline" size={16} color={C.warning} />
                <Text style={s.pendingBannerText}>
                  {pendingAcks} polic{pendingAcks === 1 ? 'y needs' : 'ies need'} your acknowledgement. Please read and tap "I have read & acknowledge".
                </Text>
              </View>
            )}
            {list.map((item) => {
              const isPolicy = segment === 'policies';
              const isOwnPolicy = isPolicy && canPost;
              const ackedAt = isPolicy ? myAcks[item.id] : null;
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
                  <Text style={s.noticeBody} numberOfLines={expandedBody[item.id] ? undefined : 2}>
                    {item.body ?? item.message}
                  </Text>
                  {(item.body ?? item.message)?.length > 90 && (
                    <TouchableOpacity
                      style={s.expandRow}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => setExpandedBody((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                    >
                      <Text style={s.expandText}>{expandedBody[item.id] ? 'Show less' : 'Show more'}</Text>
                      <Ionicons name={expandedBody[item.id] ? 'chevron-up' : 'chevron-down'} size={14} color={C.primary} />
                    </TouchableOpacity>
                  )}
                  {!!item.pdf_url && isPolicy && (
                    <View style={s.policyActions}>
                      <TouchableOpacity style={s.policyBtn} activeOpacity={0.85} onPress={() => WebBrowser.openBrowserAsync(item.pdf_url)}>
                        <Ionicons name="eye-outline" size={15} color={C.primary} />
                        <Text style={s.policyBtnText}>View</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.policyBtn} activeOpacity={0.85} disabled={busyId === item.id} onPress={() => handleDownload(item)}>
                        <Ionicons name="download-outline" size={15} color={C.primary} />
                        <Text style={s.policyBtnText}>Download</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {!!item.pdf_url && !isPolicy && (
                    isImageAttachment(item.pdf_name, item.pdf_url) ? (
                      <TouchableOpacity activeOpacity={0.85} onPress={() => WebBrowser.openBrowserAsync(item.pdf_url)}>
                        <Image source={{ uri: item.pdf_url }} style={s.attachmentImage} resizeMode="cover" />
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={s.pdfChip} activeOpacity={0.85} onPress={() => WebBrowser.openBrowserAsync(item.pdf_url)}>
                        <Ionicons name="document-attach-outline" size={15} color={C.primary} />
                        <Text style={s.pdfChipText} numberOfLines={1}>{item.pdf_name || 'View attachment'}</Text>
                      </TouchableOpacity>
                    )
                  )}
                  <Text style={s.noticeTime}>Posted {fmtDate(item.created_at)}</Text>
                  {isPolicy && (ackedAt ? (
                    <View style={s.ackedRow}>
                      <Ionicons name="checkmark-circle" size={16} color={C.success} />
                      <Text style={s.ackedText}>Acknowledged on {fmtDate(ackedAt)}</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[s.ackBtn, busyId === item.id && { opacity: 0.6 }]}
                      activeOpacity={0.85}
                      disabled={busyId === item.id}
                      onPress={() => handleAcknowledge(item)}
                    >
                      {busyId === item.id
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <>
                            <Ionicons name="shield-checkmark-outline" size={16} color="#fff" />
                            <Text style={s.ackBtnText}>I have read & acknowledge</Text>
                          </>}
                    </TouchableOpacity>
                  ))}
                  {isOwnPolicy && (
                    <View style={s.seenByRow}>
                      <Ionicons name="eye-outline" size={13} color={C.muted} />
                      <Text style={s.seenByText}>Acknowledged by {readCounts[item.id] ?? 0} · tap to see who</Text>
                    </View>
                  )}
                  {isOwnPolicy && expandedPolicyId === item.id && (
                    <View style={s.seenByList}>
                      {!readLists[item.id] ? (
                        <ActivityIndicator color={C.primary} size="small" />
                      ) : viewers.length === 0 ? (
                        <Text style={s.seenByEmpty}>No one has acknowledged this yet.</Text>
                      ) : (
                        viewers.map((r: any) => (
                          <View key={r.profile_id} style={s.seenByItem}>
                            <View style={{ flex: 1 }}>
                              <Text style={s.seenByName}>{personName(r.profile, 'EMPLOYEE')}</Text>
                              <Text style={s.seenByTime}>{r.source === 'app' ? `Mobile app${r.device ? ` · ${r.device}` : ''}` : 'Website'}</Text>
                            </View>
                            <Text style={s.seenByTime}>{fmtDateTime(r.acknowledged_at)}</Text>
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
  expandRow: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start' },
  expandText: { fontSize: 12, fontWeight: '700', color: C.primary },
  attachmentImage: { width: '100%', height: 160, borderRadius: 12, marginTop: 4, backgroundColor: C.bg },
  pdfChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: C.primaryBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginTop: 2,
  },
  pdfChipText: { fontSize: 12.5, fontWeight: '600', color: C.primary, maxWidth: 220 },
  noticeTime: { fontSize: 11, color: '#CBD5E1' },
  policyActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  policyBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.primaryBg, borderRadius: 12, paddingVertical: 10,
  },
  policyBtnText: { fontSize: 13, fontWeight: '700', color: C.primary },
  ackBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: C.success, borderRadius: 12, paddingVertical: 11, marginTop: 2,
  },
  ackBtnText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  ackedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: C.successBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
  },
  ackedText: { fontSize: 12, fontWeight: '700', color: C.success },
  pendingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.warningBg, borderLeftWidth: 3, borderLeftColor: C.warning, borderRadius: 12, padding: 12,
  },
  pendingBannerText: { flex: 1, fontSize: 12.5, color: '#92400E', fontWeight: '600' },
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
