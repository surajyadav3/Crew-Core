import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { Colors as C } from '@/constants/Colors';

/**
 * Shown when the user IS signed in but their profile couldn't be loaded yet
 * (first launch after an update with no cached profile, while offline). Keeps
 * them signed in with a retry, instead of the old behaviour of routing to the
 * register screen — which looked exactly like being logged out. There is
 * deliberately no sign-out here: employees stay signed in.
 */
export default function ConnectingScreen() {
  const { refreshProfile } = useAuth();
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try { await refreshProfile(); } finally { setRetrying(false); }
  };

  return (
    <View style={s.wrap}>
      <Ionicons name="cloud-offline-outline" size={40} color={C.muted} />
      <Text style={s.title}>Connecting to CrewCore…</Text>
      <Text style={s.body}>You're still signed in. Check your internet connection — we'll load your details as soon as you're back online.</Text>
      <TouchableOpacity style={s.btn} onPress={retry} disabled={retrying} activeOpacity={0.85}>
        {retrying ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Try again</Text>}
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#F8FAFC' },
  title: { fontSize: 17, fontWeight: '800', color: C.text, marginTop: 14 },
  body: { fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 8, lineHeight: 19 },
  btn: { marginTop: 22, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 32, minWidth: 150, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
