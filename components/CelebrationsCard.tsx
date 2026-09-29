import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useFocusEffect } from '@react-navigation/native';
import { listUpcomingCelebrations, type CelebrationPerson, type UpcomingCelebration } from '@/services/profileDetailsService';
import { Colors as C } from '@/constants/Colors';

/**
 * Mirrors the web app's BirthdaysCard / AnniversariesCard (src/pages/home/HomePage.jsx):
 * next 5 days of birthdays and work anniversaries. Employees only see people from
 * their own outlet; admins and managers see the whole tenant.
 */
const WINDOW_DAYS = 5;

const AVATAR_COLORS = ['#6C5CE7', '#0891B2', '#10B981', '#D97706', '#E11D48', '#8B5CF6', '#2563EB'];
const avatarColor = (id = '') => AVATAR_COLORS[[...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
const initials = (p: CelebrationPerson) => `${p.first_name?.[0] || ''}${p.last_name?.[0] || ''}`.toUpperCase();
const fullName = (p: CelebrationPerson) => [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').toUpperCase();
const shortDate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function PersonRow({ person, date, diffDays, badge, showDate = true }: { person: CelebrationPerson; date: string; diffDays: number; badge?: string; showDate?: boolean }) {
  const isToday = diffDays === 0;
  const subtitle = [person.division, person.outlet_location].filter(Boolean).join(' · ');
  return (
    <View style={s.row}>
      <View style={[s.avatar, { backgroundColor: avatarColor(person.id) }]}>
        <Text style={s.avatarText}>{initials(person)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.name} numberOfLines={1}>{fullName(person)}</Text>
        {!!subtitle && <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {!!badge && <View style={[s.pill, { backgroundColor: C.primaryBg }]}><Text style={[s.pillText, { color: C.primary }]}>{badge}</Text></View>}
      {showDate && (
        <View style={[s.pill, { backgroundColor: isToday ? C.successBg : C.tealBg }]}>
          <Text style={[s.pillText, { color: isToday ? C.success : C.teal }]}>{isToday ? 'Today' : shortDate(date)}</Text>
        </View>
      )}
    </View>
  );
}

function Section({ icon, iconColor, title, loading, emptyText, children, count }: {
  icon: keyof typeof Ionicons.glyphMap; iconColor: string; title: string;
  loading: boolean; emptyText: string; count: number; children: React.ReactNode;
}) {
  return (
    <View style={s.card}>
      <View style={s.labelRow}>
        <Ionicons name={icon} size={15} color={iconColor} />
        <Text style={s.label}>{title}</Text>
      </View>
      {loading ? (
        <View style={s.loadingBox}><ActivityIndicator color={C.primary} /></View>
      ) : count === 0 ? (
        <Text style={s.emptyText}>{emptyText}</Text>
      ) : (
        <View style={s.list}>{children}</View>
      )}
    </View>
  );
}

/**
 * `todayOnly` (Raniwala manager / HOD Home, mirroring its website): one combined
 * "Birthdays & Anniversaries" card with just today's, from a single RPC call.
 */
export default function CelebrationsCard({ todayOnly = false }: { todayOnly?: boolean }) {
  const { tenant } = useAuth();
  const [birthdays, setBirthdays] = useState<UpcomingCelebration[]>([]);
  const [anniversaries, setAnniversaries] = useState<UpcomingCelebration[]>([]);
  const [loading, setLoading] = useState(true);

  // Outlet scoping (employees: own outlet only) is enforced by the RPC itself.
  const load = useCallback(async () => {
    if (!tenant?.id) { setLoading(false); return; }
    const { data } = await listUpcomingCelebrations(todayOnly ? 0 : WINDOW_DAYS);
    setBirthdays(data.birthdays);
    setAnniversaries(data.anniversaries);
    setLoading(false);
  }, [tenant?.id, todayOnly]);

  // Reload whenever the Home tab regains focus, like the rest of the dashboard.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!tenant) return null;

  if (todayOnly) {
    return (
      <Section icon="gift-outline" iconColor={C.purple} title="Birthdays & Anniversaries" loading={loading}
        count={birthdays.length + anniversaries.length} emptyText="No birthdays or work anniversaries today.">
        {birthdays.map((b) => (
          <PersonRow key={`b-${b.profile.id}`} person={b.profile} date={b.date} diffDays={b.diffDays} badge="🎂 Birthday" showDate={false} />
        ))}
        {anniversaries.map((a) => (
          <PersonRow key={`a-${a.profile.id}`} person={a.profile} date={a.date} diffDays={a.diffDays}
            badge={`🎊 ${a.years} yr${a.years === 1 ? '' : 's'}`} showDate={false} />
        ))}
      </Section>
    );
  }

  return (
    <>
      <Section icon="gift-outline" iconColor={C.purple} title="Upcoming Birthdays" loading={loading}
        count={birthdays.length} emptyText={`No birthdays in the next ${WINDOW_DAYS} days.`}>
        {birthdays.map((b) => (
          <PersonRow key={b.profile.id} person={b.profile} date={b.date} diffDays={b.diffDays} />
        ))}
      </Section>
      <Section icon="ribbon-outline" iconColor={C.primary} title="Work Anniversaries" loading={loading}
        count={anniversaries.length} emptyText={`No work anniversaries in the next ${WINDOW_DAYS} days.`}>
        {anniversaries.map((a) => (
          <PersonRow key={a.profile.id} person={a.profile} date={a.date} diffDays={a.diffDays}
            badge={`${a.years} yr${a.years === 1 ? '' : 's'}`} />
        ))}
      </Section>
    </>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: 20, padding: 14, marginHorizontal: 16, marginTop: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  label: { fontSize: 12.5, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  loadingBox: { paddingVertical: 18, alignItems: 'center' },
  emptyText: { fontSize: 13, color: C.muted, paddingVertical: 6, paddingHorizontal: 4 },
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  name: { fontSize: 13.5, fontWeight: '700', color: C.text },
  subtitle: { fontSize: 11.5, color: C.muted, marginTop: 1 },
  pill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
});
