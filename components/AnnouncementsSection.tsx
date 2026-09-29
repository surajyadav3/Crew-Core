import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import { listAnnouncements, listMyAnnouncementAcks, acknowledgeAnnouncement } from '@/services/announcementService';
import { showToast } from '@/components/Toast';
import { fmtDate, personName } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const LIMIT = 5;
const PREVIEW_CHARS = 160;

function AnnouncementItem({ a, readAt, saving, onRead }: { a: any; readAt?: string; saving: boolean; onRead: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const unread = !readAt;
  const text: string = a.body || a.message || '';
  const long = text.length > PREVIEW_CHARS || text.split('\n').length > 3;

  return (
    <View style={[s.item, unread && s.itemUnread]}>
      <View style={s.itemTop}>
        <Text style={s.itemTitle}>{a.title}</Text>
        {unread && <View style={s.newPill}><Text style={s.newPillText}>NEW</Text></View>}
      </View>
      <Text style={s.itemMeta}>
        {a.author ? personName(a.author, 'HR') : 'HR'} · {fmtDate(a.created_at)}
      </Text>
      {!!text && (
        <Text style={s.itemBody} numberOfLines={expanded || !long ? undefined : 3}>{text}</Text>
      )}
      <View style={s.itemActions}>
        {long ? (
          <TouchableOpacity onPress={() => setExpanded((e) => !e)} hitSlop={8}>
            <Text style={s.linkText}>{expanded ? 'Show less' : 'Read more'}</Text>
          </TouchableOpacity>
        ) : <View />}
        {unread ? (
          <TouchableOpacity style={[s.readBtn, saving && { opacity: 0.6 }]} onPress={() => onRead(a.id)} disabled={saving} activeOpacity={0.85}>
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <><Ionicons name="checkmark" size={14} color="#fff" /><Text style={s.readBtnText}>Mark as read</Text></>}
          </TouchableOpacity>
        ) : (
          <View style={s.readDone}>
            <Ionicons name="checkmark-circle" size={14} color={C.success} />
            <Text style={s.readDoneText}>Read</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Raniwala's Home: announcements as the first, priority section — mirrors
 * the website's AnnouncementsSection (src/pages/home/HomePage.jsx). Unread
 * first; "Mark as read" writes the same announcement_acknowledgements row as
 * the website's Acknowledge button, so HR's read counts stay in sync.
 */
export default function AnnouncementsSection() {
  const { tenant, profile } = useAuth();
  const { isEnabled } = useFeatures();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [acks, setAcks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant?.id || !profile?.id) { setLoading(false); return; }
    const [annRes, ackRes] = await Promise.all([
      listAnnouncements(tenant.id, LIMIT),
      listMyAnnouncementAcks(tenant.id, profile.id),
    ]);
    setItems(annRes.data);
    setAcks(ackRes.data);
    setLoading(false);
  }, [tenant?.id, profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRead = async (id: string) => {
    if (!tenant || !profile) return;
    setSaving(id);
    const { error } = await acknowledgeAnnouncement(id, profile.id, tenant.id);
    setSaving(null);
    if (error) { showToast(error.message || 'Could not mark as read.', 'error'); return; }
    setAcks((m) => ({ ...m, [id]: new Date().toISOString() }));
  };

  // Unread first, newest first — sorted per fetch only, so a card doesn't
  // jump away the moment it's marked read.
  const sorted = useMemo(
    () => [...items].sort((x, y) => (Number(!!acks[x.id]) - Number(!!acks[y.id]))
      || (new Date(y.created_at).getTime() - new Date(x.created_at).getTime())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items]
  );
  const unreadCount = items.filter((a) => !acks[a.id]).length;

  if (!tenant || !isEnabled('announcements')) return null;

  return (
    <View style={s.wrap}>
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <View style={s.headerIcon}><Ionicons name="megaphone" size={15} color={C.warning} /></View>
          <Text style={s.headerTitle}>Announcements</Text>
          {unreadCount > 0 && <View style={s.countPill}><Text style={s.countPillText}>{unreadCount} unread</Text></View>}
        </View>
        <TouchableOpacity onPress={() => router.push('/notices' as any)} hitSlop={8}>
          <Text style={s.linkText}>View all</Text>
        </TouchableOpacity>
      </View>
      {loading ? (
        <View style={s.card}><ActivityIndicator color={C.primary} /></View>
      ) : sorted.length === 0 ? (
        <View style={[s.card, s.emptyRow]}>
          <Ionicons name="megaphone-outline" size={18} color={C.muted} />
          <Text style={s.emptyText}>No announcements right now.</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {sorted.map((a) => (
            <AnnouncementItem key={a.id} a={a} readAt={acks[a.id]} saving={saving === a.id} onRead={handleRead} />
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 4 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  headerIcon: { width: 28, height: 28, borderRadius: 9, backgroundColor: C.warningBg, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '800', color: C.text },
  countPill: { backgroundColor: C.warningBg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  countPillText: { fontSize: 11, fontWeight: '700', color: '#92400E' },
  linkText: { fontSize: 12.5, fontWeight: '700', color: C.primary },
  card: {
    backgroundColor: C.surface, borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 13, color: C.muted },
  item: {
    backgroundColor: C.surface, borderRadius: 16, padding: 14,
    borderLeftWidth: 4, borderLeftColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  itemUnread: { borderLeftColor: C.warning },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  itemTitle: { flex: 1, fontSize: 14.5, fontWeight: '800', color: C.text, lineHeight: 20 },
  newPill: { backgroundColor: C.warningBg, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, marginTop: 1 },
  newPillText: { fontSize: 10, fontWeight: '800', color: '#92400E', letterSpacing: 0.4 },
  itemMeta: { fontSize: 11.5, color: C.muted, marginTop: 3 },
  itemBody: { fontSize: 13, color: C.text, lineHeight: 19, marginTop: 8 },
  itemActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  readBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.primary,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, minWidth: 110, justifyContent: 'center',
  },
  readBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  readDone: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readDoneText: { fontSize: 12, fontWeight: '700', color: C.success },
});
