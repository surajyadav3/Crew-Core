import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { setStatusBarStyle } from 'expo-status-bar';
import { Colors as C } from '@/constants/Colors';

/**
 * The website's page header (src/components/Header.jsx): a white bar with
 * the page title and a muted breadcrumb line under it. While a screen using
 * it is focused the status bar turns dark-on-white, and goes back to the
 * app's light style when it loses focus.
 */
export default function PageHeader({
  title, subtitle, onBack, right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  useFocusEffect(useCallback(() => {
    setStatusBarStyle('dark');
    return () => setStatusBarStyle('light');
  }, []));

  return (
    <View style={s.bar}>
      {onBack && (
        <TouchableOpacity onPress={onBack} style={s.back} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={19} color={C.text} />
        </TouchableOpacity>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  back: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '700', color: C.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 12.5, color: C.muted, marginTop: 2 },
});
