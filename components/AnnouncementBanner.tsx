import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import { listAnnouncements } from '@/services/announcementService';
import { fmtDate } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

// A small fixed rotation of gradients (announcements have no "theme" to
// keyword-match against, unlike holidays) — cycles by index so consecutive
// announcements in the carousel read as visually distinct.
const GRADIENTS: [string, string, ...string[]][] = [
  ['#1e293b', C.primaryDark, C.primary],
  ['#312e81', '#4338ca', '#6366f1'],
  ['#0f766e', '#0e7490', '#06b6d4'],
];

/**
 * Announcements as a glanceable Home banner, styled after HolidayBanner —
 * additive to the "Announcements & Updates" list below it, which carries
 * read/unread notification state this banner doesn't need to duplicate.
 */
export default function AnnouncementBanner() {
  const { tenant } = useAuth();
  const { isEnabled } = useFeatures();
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);

  const fetchAnnouncements = useCallback(async () => {
    if (!tenant?.id) { setLoading(false); return; }
    const { data } = await listAnnouncements(tenant.id);
    setAnnouncements((data || []).slice(0, 8));
    setIndex(0);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { fetchAnnouncements(); }, [fetchAnnouncements]);

  if (!tenant || !isEnabled('announcements')) return null;
  if (!loading && announcements.length === 0) return null;

  const current = announcements[index];
  const gradient = GRADIENTS[index % GRADIENTS.length];
  const prev = () => setIndex((i) => (i - 1 + announcements.length) % announcements.length);
  const next = () => setIndex((i) => (i + 1) % announcements.length);

  return (
    <View style={s.card}>
      <View style={s.labelRow}>
        <Text style={s.label}>Announcements</Text>
        {announcements.length > 1 && <Text style={s.count}>{index + 1} / {announcements.length}</Text>}
      </View>
      {loading ? (
        <View style={s.loadingBox}><ActivityIndicator color={C.primary} /></View>
      ) : (
        <TouchableOpacity activeOpacity={0.9} onPress={() => router.push('/notices' as any)}>
          <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.banner}>
            {announcements.length > 1 && (
              <TouchableOpacity style={s.navBtn} onPress={prev} hitSlop={10}>
                <Ionicons name="chevron-back" size={16} color="#fff" />
              </TouchableOpacity>
            )}
            <View style={s.iconWrap}>
              <Ionicons name="megaphone" size={24} color="#fff" />
            </View>
            <View style={s.textWrap}>
              <Text style={s.title} numberOfLines={1}>{current.title}</Text>
              {!!current.message && <Text style={s.message} numberOfLines={2}>{current.message}</Text>}
              <Text style={s.date}>{fmtDate(current.created_at)}</Text>
            </View>
            {announcements.length > 1 && (
              <TouchableOpacity style={s.navBtn} onPress={next} hitSlop={10}>
                <Ionicons name="chevron-forward" size={16} color="#fff" />
              </TouchableOpacity>
            )}
          </LinearGradient>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: 20, padding: 14, marginHorizontal: 16, marginTop: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  label: { fontSize: 12.5, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  count: { fontSize: 11.5, fontWeight: '600', color: C.muted },
  loadingBox: { paddingVertical: 24, alignItems: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 14, minHeight: 76 },
  navBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  iconWrap: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1 },
  title: { fontSize: 15, fontWeight: '800', color: '#fff' },
  message: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2, lineHeight: 16 },
  date: { fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 4 },
});
