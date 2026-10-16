import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { dateStr, monthLabel } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * A small month calendar for picking one day between `min` and `max`
 * (YYYY-MM-DD, inclusive). Days outside the range are greyed out and can't
 * be tapped; the arrows only move across months that have a pickable day.
 */
export default function DayPicker({ value, min, max, onChange }: {
  value: string;
  min: string;
  max: string;
  onChange: (ds: string) => void;
}) {
  const start = value && value >= min && value <= max ? value : max;
  const [ym, setYm] = useState(() => ({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 }));

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = new Date(ym.y, ym.m, 1); d.getMonth() === ym.m; d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return out;
  }, [ym.y, ym.m]);

  const monthKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
  const canPrev = monthKey(ym.y, ym.m) > min.slice(0, 7);
  const canNext = monthKey(ym.y, ym.m) < max.slice(0, 7);
  const shift = (delta: number) => setYm(({ y, m }) => {
    const d = new Date(y, m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  return (
    <View style={s.wrap}>
      <View style={s.nav}>
        <TouchableOpacity onPress={() => shift(-1)} disabled={!canPrev} style={[s.navBtn, !canPrev && { opacity: 0.3 }]} hitSlop={8} accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={16} color={C.text} />
        </TouchableOpacity>
        <Text style={s.month}>{monthLabel(ym.m, ym.y)}</Text>
        <TouchableOpacity onPress={() => shift(1)} disabled={!canNext} style={[s.navBtn, !canNext && { opacity: 0.3 }]} hitSlop={8} accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={16} color={C.text} />
        </TouchableOpacity>
      </View>
      <View style={s.row}>
        {WEEKDAYS.map((w, i) => <Text key={i} style={s.weekday}>{w}</Text>)}
      </View>
      <View style={s.grid}>
        {Array.from({ length: days[0]?.getDay() || 0 }).map((_, i) => <View key={`b${i}`} style={s.cell} />)}
        {days.map((d) => {
          const ds = dateStr(d);
          const enabled = ds >= min && ds <= max;
          const selected = ds === value;
          const today = ds === max;
          return (
            <TouchableOpacity key={ds} style={s.cell} disabled={!enabled} onPress={() => onChange(ds)} activeOpacity={0.7}>
              <View style={[s.day, selected && s.daySelected, !selected && today && s.dayToday]}>
                <Text style={[s.dayText, !enabled && s.dayDisabled, selected && s.dayTextSelected]}>{d.getDate()}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 10 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  navBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  month: { fontSize: 14, fontWeight: '700', color: C.text },
  row: { flexDirection: 'row' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 11, fontWeight: '600', color: C.muted, paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1.15, padding: 2 },
  day: { flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  daySelected: { backgroundColor: C.primary },
  dayToday: { borderWidth: 1, borderColor: C.primary },
  dayText: { fontSize: 13, fontWeight: '600', color: C.text },
  dayDisabled: { color: '#CBD5E1', fontWeight: '400' },
  dayTextSelected: { color: '#fff', fontWeight: '700' },
});
