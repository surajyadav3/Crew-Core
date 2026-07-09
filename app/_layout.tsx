import 'react-native-url-polyfill/auto';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, Animated, StyleSheet, Dimensions, Easing } from 'react-native';
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
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/components/Toast';
import { initNotificationResponseListener, markNavigationReady } from '@/lib/pushNotifications';

SplashScreen.preventAutoHideAsync().catch(() => {});

const { width: W, height: H } = Dimensions.get('window');

const BG      = '#080D1A';
const PRIMARY = '#6C5CE7';
const ACCENT  = '#A78BFA';

// ── Ambient orb (large blurry colour blob) ─────────────────────────────────────
function Orb({ cx, cy, size, color, delay }: { cx: number; cy: number; size: number; color: string; delay: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.85)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(scale,   { toValue: 1,  duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]),
    ]).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.06, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1.00, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    });
  }, []);
  return (
    <Animated.View style={{
      position: 'absolute',
      left: cx - size / 2, top: cy - size / 2,
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color,
      opacity, transform: [{ scale }],
    }} />
  );
}

// ── Pulse ring that expands outward ────────────────────────────────────────────
function PulseRing({ delay, size }: { delay: number; size: number }) {
  const scale   = useRef(new Animated.Value(0.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = () =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.45, duration: 250, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0,    duration: 1550, useNativeDriver: true }),
          ]),
        ]),
        Animated.parallel([
          Animated.timing(scale,   { toValue: 0.5, duration: 0, useNativeDriver: true }),
        ]),
      ]);
    Animated.loop(run()).start();
  }, []);
  return (
    <Animated.View style={{
      position: 'absolute',
      width: size, height: size, borderRadius: size / 2,
      borderWidth: 1, borderColor: ACCENT,
      opacity, transform: [{ scale }],
    }} />
  );
}

// ── Splash overlay ─────────────────────────────────────────────────────────────
const APP_NAME = 'CrewCore';

function SplashOverlay({ onDone }: { onDone: () => void }) {
  const logoScale   = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const shineX      = useRef(new Animated.Value(-120)).current;
  const tagOpacity  = useRef(new Animated.Value(0)).current;
  const tagY        = useRef(new Animated.Value(10)).current;
  const progressW   = useRef(new Animated.Value(0)).current;
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const exitScale   = useRef(new Animated.Value(1)).current;

  // One animated value per character
  const charValues = useRef(
    APP_NAME.split('').map(() => ({
      opacity: new Animated.Value(0),
      y:       new Animated.Value(18),
    }))
  ).current;

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});

    // Phase 1 — Logo springs in (0 ms)
    Animated.parallel([
      Animated.spring(logoScale,   { toValue: 1, useNativeDriver: true, damping: 9, stiffness: 200, mass: 0.7 }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();

    // Phase 2 — Shine sweeps across logo plate (300 ms)
    Animated.sequence([
      Animated.delay(300),
      Animated.timing(shineX, { toValue: 120, duration: 380, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();

    // Phase 3 — Characters stagger in (420 ms base, 55 ms apart)
    APP_NAME.split('').forEach((_, i) => {
      Animated.sequence([
        Animated.delay(420 + i * 55),
        Animated.parallel([
          Animated.spring(charValues[i].y, { toValue: 0, useNativeDriver: true, damping: 11, stiffness: 220 }),
          Animated.timing(charValues[i].opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]),
      ]).start();
    });

    // Phase 4 — Tagline slides up (900 ms)
    Animated.sequence([
      Animated.delay(900),
      Animated.parallel([
        Animated.spring(tagY,      { toValue: 0, useNativeDriver: true, damping: 13, stiffness: 180 }),
        Animated.timing(tagOpacity,{ toValue: 1, duration: 320, useNativeDriver: true }),
      ]),
    ]).start();

    // Phase 5 — Progress line draws (1050 ms → 1750 ms)
    Animated.sequence([
      Animated.delay(1050),
      Animated.timing(progressW, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ]).start();

    // Phase 6 — Exit: scale up + fade out (2050 ms)
    Animated.sequence([
      Animated.delay(2050),
      Animated.parallel([
        Animated.timing(exitOpacity, { toValue: 0, duration: 420, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        Animated.timing(exitScale,   { toValue: 1.07, duration: 420, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    ]).start(onDone);
  }, []);

  const progressBarWidth = progressW.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Animated.View
      style={[sp.overlay, { opacity: exitOpacity, transform: [{ scale: exitScale }] }]}
      pointerEvents="none"
    >
      {/* Ambient orbs */}
      <Orb cx={W * 0.15} cy={H * 0.22} size={300} color="rgba(37,99,235,0.14)" delay={0} />
      <Orb cx={W * 0.88} cy={H * 0.72} size={260} color="rgba(99,102,241,0.10)" delay={200} />
      <Orb cx={W * 0.5}  cy={H * 0.9}  size={200} color="rgba(59,130,246,0.09)" delay={400} />

      {/* Pulse rings behind logo */}
      <PulseRing delay={0}    size={180} />
      <PulseRing delay={700}  size={260} />
      <PulseRing delay={1400} size={340} />

      {/* ── Logo ─────────────────────────────────────────── */}
      <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }], alignItems: 'center' }}>
        <View style={sp.logoBox}>
          <Ionicons name="briefcase" size={40} color="#fff" />
          {/* Shine sweep */}
          <Animated.View
            style={[sp.shine, { transform: [{ translateX: shineX }, { rotate: '20deg' }] }]}
          />
        </View>
      </Animated.View>

      {/* ── App name (per-character) ──────────────────────── */}
      <View style={sp.nameRow}>
        {APP_NAME.split('').map((char, i) => (
          <Animated.Text
            key={i}
            style={[
              sp.nameChar,
              i < 4 ? sp.nameWhite : sp.nameBlue,
              { opacity: charValues[i].opacity, transform: [{ translateY: charValues[i].y }] },
            ]}
          >
            {char}
          </Animated.Text>
        ))}
      </View>

      {/* ── Tagline ───────────────────────────────────────── */}
      <Animated.Text style={[sp.tagline, { opacity: tagOpacity, transform: [{ translateY: tagY }] }]}>
        Smart Payroll · Modern Teams
      </Animated.Text>

      {/* ── Progress line ─────────────────────────────────── */}
      <View style={sp.progressTrack}>
        <Animated.View style={[sp.progressFill, { width: progressBarWidth }]} />
      </View>

      {/* ── Version ───────────────────────────────────────── */}
      <Animated.Text style={[sp.version, { opacity: tagOpacity }]}>v1.1.0</Animated.Text>
    </Animated.View>
  );
}

const sp = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 999, elevation: 999,
  },
  logoBox: {
    width: 92, height: 92, borderRadius: 28,
    backgroundColor: PRIMARY,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: PRIMARY, shadowOpacity: 0.8, shadowRadius: 36, elevation: 24,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    marginBottom: 34,
    overflow: 'hidden',
  },
  shine: {
    position: 'absolute',
    top: 0, bottom: 0,
    width: 40,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  nameChar: {
    fontSize: 44, fontWeight: '900', letterSpacing: -1,
  },
  nameWhite: { color: '#F0F6FF' },
  nameBlue:  { color: ACCENT },
  tagline: {
    fontSize: 11, fontWeight: '500',
    color: 'rgba(148,163,184,0.7)', letterSpacing: 2.2,
    textTransform: 'uppercase', marginBottom: 52,
  },
  progressTrack: {
    position: 'absolute', bottom: H * 0.1,
    width: 120, height: 2, borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%', borderRadius: 1,
    backgroundColor: ACCENT,
    shadowColor: ACCENT, shadowOpacity: 1, shadowRadius: 4,
  },
  version: {
    position: 'absolute', bottom: H * 0.1 - 22,
    fontSize: 10, color: 'rgba(148,163,184,0.35)', letterSpacing: 1,
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
  componentDidCatch(error: Error) {
    console.error('[CrewCore]', error);
    AsyncStorage.setItem('__crewcore_crash', `${error?.message ?? 'unknown'}\n${(error?.stack ?? '').slice(0, 600)}`).catch(() => {});
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
      Alert.alert('Previous Session Crash', msg, [
        { text: 'Clear & Continue', onPress: () => AsyncStorage.removeItem('__crewcore_crash') },
      ]);
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
        <ToastProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
          </Stack>
          {!splashDone && <SplashOverlay onDone={() => setSplashDone(true)} />}
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
