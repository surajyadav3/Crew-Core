import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Linking, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  AppUpdateInfo, checkForAppUpdate, currentAppVersion, STORE_DEEP_LINK, STORE_URL,
} from '@/services/appUpdateService';
import { Colors as C } from '@/constants/Colors';
import { presentLocalNotification } from '@/lib/pushNotifications';

const SNOOZE_KEY = '__crewcore_update_snooze'; // `${version}|${until ms}`
const NOTIFIED_KEY = '__crewcore_update_notified'; // last version announced in the notification centre
const SNOOZE_MS = 24 * 60 * 60 * 1000;
// One lookup per app open, plus on returning to the foreground at most this often.
const RECHECK_MS = 6 * 60 * 60 * 1000;

/**
 * "Update available" prompt, shown when app_releases says a newer store
 * build is out. "Later" hides it for a day; when this install is below the
 * release's min_version there is no "Later".
 */
export default function AppUpdatePrompt() {
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);
  const lastCheck = useRef(0);

  const check = useCallback(async () => {
    if (Date.now() - lastCheck.current < RECHECK_MS) return;
    lastCheck.current = Date.now();
    const info = await checkForAppUpdate().catch(() => null);
    if (!info) { setUpdate(null); return; }
    // Also drop it in the phone's notification centre, once per version.
    const notified = await AsyncStorage.getItem(NOTIFIED_KEY).catch(() => null);
    if (notified !== info.latestVersion) {
      AsyncStorage.setItem(NOTIFIED_KEY, info.latestVersion).catch(() => {});
      presentLocalNotification(
        'CrewCore update available',
        `Version ${info.latestVersion} is out. Please update to see the latest changes.`,
        { type: 'app_update' },
      );
    }
    if (!info.forced) {
      const snooze = await AsyncStorage.getItem(SNOOZE_KEY).catch(() => null);
      const [version, until] = (snooze || '').split('|');
      if (version === info.latestVersion && Date.now() < Number(until)) return;
    }
    setUpdate(info);
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => sub.remove();
  }, [check]);

  if (!update) return null;

  const openStore = () => {
    Linking.openURL(STORE_DEEP_LINK).catch(() => Linking.openURL(STORE_URL).catch(() => {}));
  };
  const later = () => {
    AsyncStorage.setItem(SNOOZE_KEY, `${update.latestVersion}|${Date.now() + SNOOZE_MS}`).catch(() => {});
    setUpdate(null);
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={update.forced ? () => {} : later}>
      <View style={s.overlay}>
        <View style={s.card}>
          <View style={s.iconWrap}>
            <Ionicons name="rocket-outline" size={28} color={C.primary} />
          </View>
          <Text style={s.title}>Update available</Text>
          <Text style={s.body}>
            A new version of CrewCore is available. Please update to see the latest changes.
          </Text>
          <Text style={s.versions}>
            Your version {currentAppVersion()}  ·  Latest {update.latestVersion}
          </Text>
          {!!update.notes && (
            <View style={s.notes}>
              <Text style={s.notesLabel}>What's new</Text>
              <Text style={s.notesText}>{update.notes}</Text>
            </View>
          )}
          <TouchableOpacity style={s.primaryBtn} onPress={openStore} activeOpacity={0.85}>
            <Text style={s.primaryBtnText}>Update now</Text>
          </TouchableOpacity>
          {!update.forced && (
            <TouchableOpacity style={s.laterBtn} onPress={later}>
              <Text style={s.laterText}>Later</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, backgroundColor: C.surface, borderRadius: 20, padding: 24, alignItems: 'center' },
  iconWrap: { width: 60, height: 60, borderRadius: 18, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 19, fontWeight: '800', color: C.text, marginBottom: 8 },
  body: { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 21 },
  versions: { fontSize: 12, color: C.muted, marginTop: 10 },
  notes: { alignSelf: 'stretch', backgroundColor: C.bg, borderRadius: 12, padding: 12, marginTop: 14 },
  notesLabel: { fontSize: 12, fontWeight: '700', color: C.primary, marginBottom: 4 },
  notesText: { fontSize: 13, color: C.text, lineHeight: 19 },
  primaryBtn: { alignSelf: 'stretch', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  laterBtn: { paddingVertical: 12, paddingHorizontal: 24, marginTop: 4 },
  laterText: { color: C.muted, fontSize: 14, fontWeight: '600' },
});
