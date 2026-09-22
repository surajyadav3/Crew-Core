import 'react-native-url-polyfill/auto';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, Animated, StyleSheet, Easing, Image, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Font from 'expo-font';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from '@expo-google-fonts/outfit';
import { Stack, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { Colors } from '@/constants/Colors';
import { AuthProvider } from '@/context/AuthContext';
import { FeatureProvider } from '@/context/FeatureContext';
import { ToastProvider } from '@/components/Toast';
import ForcePasswordChange from '@/components/ForcePasswordChange';
import LocationConsentGate from '@/components/LocationConsentGate';
import { initNotificationResponseListener, markNavigationReady } from '@/lib/pushNotifications';

SplashScreen.preventAutoHideAsync().catch(() => {});

const BG      = '#080D1A';
const PRIMARY = '#6C5CE7';

// ── Splash overlay ─────────────────────────────────────────────────────────────
// Plain white background, the logo centered, and the wordmark typed out
// slowly underneath. Nothing else — no rings, no orbs, no shine.
const WORDMARK = 'Crew Core';
const SUBMARK  = 'HRMS';

const { height: SCREEN_H } = Dimensions.get('window');

function SplashOverlay({ onDone }: { onDone: () => void }) {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  // Starts well above the top of the screen so it visibly falls all the way
  // down to its resting place at center, rather than just nudging in.
  const logoDrop    = useRef(new Animated.Value(-(SCREEN_H / 2 + 160))).current;
  const typeProgress = useRef(new Animated.Value(0)).current;
  const subOpacity  = useRef(new Animated.Value(0)).current;
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const [typedText, setTypedText] = useState('');

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});

    // react-native-web's native driver can't animate non-transform/opacity
    // values, and the typewriter progress below drives plain text — keep
    // everything on the JS driver so it works the same on every platform.
    const native = false;

    const id = typeProgress.addListener(({ value }) => {
      setTypedText(WORDMARK.slice(0, Math.round(value)));
    });

    Animated.sequence([
      // Phase 1 — Logo falls from the top and eases into a soft, single
      // overshoot-settle at center (a smooth cubic curve reads far less
      // mechanical here than the hard-cornered Easing.bounce did).
      Animated.parallel([
        Animated.timing(logoOpacity, { toValue: 1, duration: 220, useNativeDriver: native }),
        Animated.timing(logoDrop,    { toValue: 0, duration: 950, easing: Easing.out(Easing.back(1.3)), useNativeDriver: native }),
      ]),
      // Phase 2 — "Crew Core" types out slowly, letter by letter
      Animated.timing(typeProgress, {
        toValue: WORDMARK.length,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: native,
      }),
      // Phase 3 — "HRMS" fades in underneath
      Animated.timing(subOpacity, { toValue: 1, duration: 300, useNativeDriver: native }),
      // Brief pause to let it be read, then exit
      Animated.delay(400),
      Animated.timing(exitOpacity, { toValue: 0, duration: 300, easing: Easing.in(Easing.ease), useNativeDriver: native }),
    ]).start(onDone);

    return () => typeProgress.removeListener(id);
  }, []);

  return (
    <Animated.View style={[sp.overlay, { opacity: exitOpacity }]} pointerEvents="none">
      <Animated.View style={{ opacity: logoOpacity, transform: [{ translateY: logoDrop }], alignItems: 'center' }}>
        <Image source={require('@/assets/icon.png')} style={sp.logo} resizeMode="contain" />
      </Animated.View>
      <Text style={sp.wordmark}>{typedText}</Text>
      <Animated.Text style={[sp.subtext, { opacity: subOpacity }]}>{SUBMARK}</Animated.Text>
    </Animated.View>
  );
}

const sp = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.bg,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 999, elevation: 999,
  },
  logo: {
    width: 96, height: 96, borderRadius: 24,
    marginBottom: 22,
  },
  wordmark: {
    fontSize: 30, fontWeight: '800', letterSpacing: 0.2,
    color: Colors.primary, height: 38,
  },
  subtext: {
    fontSize: 13, fontWeight: '600', letterSpacing: 2,
    color: Colors.primary, marginTop: 2, textTransform: 'uppercase',
  },
});

// ── Error boundary ─────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error?.message ?? 'Unknown error' };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Full message + stack goes to the console/crash log for debugging; only a
    // generic notice is ever persisted for the user-facing "previous crash" alert
    // below, so we don't surface internal stack traces / file paths to end users.
    console.error('[CrewCore]', error, info?.componentStack);
    AsyncStorage.setItem('__crewcore_crash', new Date().toLocaleString()).catch(() => {});
  }
  render() {
    if (this.state.hasError) return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, backgroundColor: BG }}>
        <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: '#1A1A28', alignItems: 'center', justifyContent: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#FF6B6B30' }}>
          <Ionicons name="warning-outline" size={28} color="#FF6B6B" />
        </View>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#F0F0FF', marginBottom: 8, textAlign: 'center' }}>Something went wrong</Text>
        <Text style={{ fontSize: 13, color: '#8888AA', textAlign: 'center', marginBottom: 28, lineHeight: 20 }}>{this.state.error}</Text>
        <TouchableOpacity onPress={() => this.setState({ hasError: false, error: '' })}
          style={{ backgroundColor: PRIMARY, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, shadowColor: PRIMARY, shadowOpacity: 0.5, shadowRadius: 12, elevation: 6 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
    return this.props.children;
  }
}

// Global Font Override Helper
function configureGlobalFont() {
  const customFontMap: Record<string, string> = {
    '100': 'Outfit-Regular',
    '200': 'Outfit-Regular',
    '300': 'Outfit-Regular',
    '400': 'Outfit-Regular',
    '500': 'Outfit-Medium',
    '600': 'Outfit-SemiBold',
    '700': 'Outfit-Bold',
    '800': 'Outfit-ExtraBold',
    '900': 'Outfit-ExtraBold',
    normal: 'Outfit-Regular',
    bold: 'Outfit-Bold',
  };

  const overrideStyle = (style: any) => {
    if (!style) return { fontFamily: 'Outfit-Regular' };
    const flat = StyleSheet.flatten(style);
    const weight = flat.fontWeight || 'normal';
    const resolvedFont = customFontMap[String(weight)] || 'Outfit-Regular';
    return { fontFamily: resolvedFont };
  };

  const oldRender = (Text as any).render;
  (Text as any).render = function (...args: any[]) {
    const origin = oldRender.call(this, ...args);
    const fontStyle = overrideStyle(origin.props.style);
    return React.cloneElement(origin, {
      style: [fontStyle, origin.props.style],
    });
  };

  const oldTextInputRender = (TextInput as any).render;
  (TextInput as any).render = function (...args: any[]) {
    const origin = oldTextInputRender.call(this, ...args);
    const fontStyle = overrideStyle(origin.props.style);
    return React.cloneElement(origin, {
      style: [fontStyle, origin.props.style],
    });
  };
}

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('__crewcore_crash').then((msg) => {
      if (!msg) return;
      Alert.alert(
        'App Restarted After a Crash',
        `CrewCore ran into a problem and had to restart (${msg}). Your data is safe — if this keeps happening, please contact support.`,
        [{ text: 'OK', onPress: () => AsyncStorage.removeItem('__crewcore_crash') }],
      );
    }).catch(() => {});
  }, []);

  useEffect(() => {
    async function loadFonts() {
      try {
        await Font.loadAsync({
          'Outfit-Regular': Outfit_400Regular,
          'Outfit-Medium': Outfit_500Medium,
          'Outfit-SemiBold': Outfit_600SemiBold,
          'Outfit-Bold': Outfit_700Bold,
          'Outfit-ExtraBold': Outfit_800ExtraBold,
        });
        configureGlobalFont();
        setFontsLoaded(true);
      } catch (err) {
        console.error('[CrewCore] Font load failed, fallback to system fonts:', err);
        setFontsLoaded(true); // Fallback to true so the app is still usable
      }
    }
    loadFonts();
  }, []);

  useEffect(() => {
    return initNotificationResponseListener();
  }, []);

  const rootNavigationState = useRootNavigationState();
  useEffect(() => {
    if (rootNavigationState?.key) markNavigationReady();
  }, [rootNavigationState?.key]);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <FeatureProvider>
          <ToastProvider>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
            </Stack>
            <ForcePasswordChange />
            <LocationConsentGate />
            {!splashDone && <SplashOverlay onDone={() => setSplashDone(true)} />}
          </ToastProvider>
        </FeatureProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
