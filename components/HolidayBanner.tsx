import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { listHolidays } from '@/services/holidayService';
import { todayStr } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

/**
 * Mirrors the web app's HolidaysCard (src/pages/home/HomePage.jsx) — same
 * festival-keyword-matched theme, same "next N upcoming approved holidays"
 * carousel. The web illustrates each theme with a CSS gradient + FontAwesome
 * icon; this is the closest Ionicons + expo-linear-gradient equivalent, kept
 * in the same spirit (colorful, festive) rather than pixel-identical.
 */
const HOLIDAY_THEMES: { match: RegExp; colors: [string, string, ...string[]]; icon: keyof typeof Ionicons.glyphMap }[] = [
  { match: /independence|republic/i, colors: ['#0b3d24', '#15803d', '#f97316'], icon: 'flag' },
  { match: /diwali|deepavali/i, colors: ['#7c2d12', '#c2410c', '#f59e0b'], icon: 'flame' },
  { match: /holi/i, colors: ['#7e22ce', '#db2777', '#f59e0b'], icon: 'color-palette' },
  { match: /christmas/i, colors: ['#14532d', '#166534', '#dc2626'], icon: 'gift' },
  { match: /eid/i, colors: ['#0f766e', '#0e7490', '#facc15'], icon: 'moon' },
  { match: /gandhi/i, colors: ['#1e3a8a', '#3730a3', '#93c5fd'], icon: 'flower' },
  { match: /new year/i, colors: ['#312e81', '#6d28d9', '#db2777'], icon: 'sparkles' },
  { match: /pongal|makar|sankranti/i, colors: ['#92400e', '#d97706', '#fde047'], icon: 'sunny' },
  { match: /raksha|rakhi/i, colors: ['#9d174d', '#db2777', '#f472b6'], icon: 'heart' },
  { match: /friday|easter/i, colors: ['#312e81', '#4338ca', '#a5b4fc'], icon: 'egg' },
];
const DEFAULT_THEME: { colors: [string, string, ...string[]]; icon: keyof typeof Ionicons.glyphMap } = {
  colors: ['#312e81', '#6d28d9', '#db2777'], icon: 'gift-outline',
};
const getHolidayTheme = (name = '') => HOLIDAY_THEMES.find((t) => t.match.test(name)) || DEFAULT_THEME;

/** `todayOnly` (Raniwala HOD / HR Home): just today's holiday, and nothing at all on a working day. */
export default function HolidayBanner({ todayOnly = false }: { todayOnly?: boolean }) {
  const { tenant, profile } = useAuth();
  const [holidays, setHolidays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);

  const fetchHolidays = useCallback(async () => {
    if (!tenant?.id) { setLoading(false); return; }
    const today = todayStr();
    const { data } = await listHolidays(tenant.id, profile?.outlet_id);
    // Every upcoming approved holiday for the employee's branch (+ company-wide).
    const upcoming = (data || [])
      .filter((h: any) => h.status === 'Approved' && (todayOnly ? h.date === today : h.date >= today));
    setHolidays(upcoming);
    setIndex(0);
    setLoading(false);
  }, [tenant?.id, profile?.outlet_id, todayOnly]);

  useEffect(() => { fetchHolidays(); }, [fetchHolidays]);

  if (!tenant) return null;
  if (todayOnly && (loading || holidays.length === 0)) return null;

  const current = holidays[index];
  const theme = getHolidayTheme(current?.name);
  const prev = () => setIndex((i) => (i - 1 + holidays.length) % holidays.length);
  const next = () => setIndex((i) => (i + 1) % holidays.length);

  return (
    <View style={s.card}>
      <View style={s.labelRow}>
        <Text style={s.label}>Holidays</Text>
        {holidays.length > 1 && <Text style={s.count}>{index + 1} / {holidays.length}</Text>}
      </View>
      {loading ? (
        <View style={s.loadingBox}><ActivityIndicator color={C.primary} /></View>
      ) : !current ? (
        <View style={s.emptyBox}>
          <Ionicons name="calendar-clear-outline" size={20} color={C.muted} />
          <Text style={s.emptyText}>No upcoming holidays.</Text>
        </View>
      ) : (
        <LinearGradient colors={theme.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.banner}>
          {holidays.length > 1 && (
            <TouchableOpacity style={s.navBtn} onPress={prev} hitSlop={10}>
              <Ionicons name="chevron-back" size={16} color="#fff" />
            </TouchableOpacity>
          )}
          <View style={s.iconWrap}>
            <Ionicons name={theme.icon} size={26} color="#fff" />
          </View>
          <View style={s.textWrap}>
            <Text style={s.name} numberOfLines={1}>{current.name}</Text>
            <Text style={s.date}>
              {new Date(current.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </View>
          {holidays.length > 1 && (
            <TouchableOpacity style={s.navBtn} onPress={next} hitSlop={10}>
              <Ionicons name="chevron-forward" size={16} color="#fff" />
            </TouchableOpacity>
          )}
        </LinearGradient>
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
  emptyBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 4 },
  emptyText: { fontSize: 13, color: C.muted },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 14, minHeight: 76 },
  navBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  iconWrap: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1 },
  name: { fontSize: 16, fontWeight: '800', color: '#fff' },
  date: { fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
});
