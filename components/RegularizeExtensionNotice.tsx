import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { regularizeExtensionNotice } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

/** Banner shown on the regularize screens only while the tenant's extended window is open. */
export default function RegularizeExtensionNotice({ tenant, style }: { tenant: any; style?: StyleProp<ViewStyle> }) {
  const text = regularizeExtensionNotice(tenant);
  if (!text) return null;
  return (
    <View style={[s.banner, style]}>
      <Ionicons name="alert-circle" size={16} color={C.warning} />
      <Text style={s.text}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: C.warningBg, borderLeftWidth: 3, borderLeftColor: C.warning,
    borderRadius: 12, padding: 12, marginHorizontal: 14, marginTop: 12,
  },
  text: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 18, color: '#92400E' },
});
