import 'react-native-url-polyfill/auto';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, Animated, StyleSheet, Dimensions, Easing } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Font from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/components/Toast';
import { NotificationProvider } from '@/components/NotificationBanner';

SplashScreen.preventAutoHideAsync().catch(() => {});

const { width: W, height: H } = Dimensions.get('window');

const BG      = '#0C0C15';
const PRIMARY = '#8B7CF8';
const RING    = 'rgba(139,124,248,0.18)';

// ── Star particle ──────────────────────────────────────────────────────────────
function Star({ x, y, size, delay }: { x: number; y: number; size: number; delay: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.1, duration: 1200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.delay(Math.random() * 1000),
      ])
    ).start();
  }, []);
  return <Animated.View style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size / 2, backgroundColor: '#ffffff', opacity }} />;
}

// ── Glow ring ──────────────────────────────────────────────────────────────────
function GlowRing({ delay, baseSize }: { delay: number; baseSize: number }) {
  const scale   = useRef(new Animated.Value(0.4)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.6, duration: 300, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0,   duration: 1300, useNativeDriver: true }),
          ]),
        ]),
        Animated.timing(scale, { toValue: 0.4, duration: 0, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={{
      position: 'absolute',
      width: baseSize, height: baseSize, borderRadius: baseSize / 2,
      borderWidth: 1, borderColor: PRIMARY,
      opacity, transform: [{ scale }],
    }} />
  );
}

// ── Splash overlay ─────────────────────────────────────────────────────────────
function SplashOverlay({ onDone }: { onDone: () => void }) {
  const logoScale   = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoGlow    = useRef(new Animated.Value(0)).current;
  const nameY       = useRef(new Animated.Value(24)).current;
  const nameOpacity = useRef(new Animated.Value(0)).current;
  const tagOpacity  = useRef(new Animated.Value(0)).current;
  const barScale    = useRef(new Animated.Value(0)).current;
  const exitOpacity = useRef(new Animated.Value(1)).current;

  const STARS = Array.from({ length: 30 }, (_, i) => ({
    x: Math.random() * W,
    y: Math.random() * H,
    size: Math.random() * 2 + 1,
    delay: Math.random() * 2000,
  }));

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    Animated.sequence([
      Animated.parallel([
        Animated.spring(logoScale,   { toValue: 1, useNativeDriver: true, damping: 11, stiffness: 180, mass: 0.8 }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(logoGlow,    { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.spring(nameY,      { toValue: 0, useNativeDriver: true, damping: 14, stiffness: 160 }),
        Animated.timing(nameOpacity,{ toValue: 1, duration: 350, useNativeDriver: true }),
      ]),
      Animated.timing(tagOpacity,  { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(barScale,    { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 120 }),
      Animated.delay(900),
      Animated.timing(exitOpacity, { toValue: 0, duration: 500, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(onDone);
  }, []);

  const glowOpacity = logoGlow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] });

  return (
    <Animated.View style={[sp.overlay, { opacity: exitOpacity }]} pointerEvents="none">
      {/* Stars */}
      {STARS.map((s, i) => <Star key={i} {...s} />)}

      {/* Glow rings */}
      <GlowRing delay={0}    baseSize={160} />
      <GlowRing delay={600}  baseSize={240} />
      <GlowRing delay={1200} baseSize={320} />

      {/* Logo */}
      <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }], alignItems: 'center' }}>
        {/* Outer glow */}
        <Animated.View style={[sp.logoGlow, { opacity: glowOpacity }]} />
        <View style={sp.logoBox}>
          <Ionicons name="briefcase" size={38} color="#fff" />
        </View>
      </Animated.View>

      {/* Name */}
      <Animated.Text style={[sp.appName, { opacity: nameOpacity, transform: [{ translateY: nameY }] }]}>
        CrewCore
      </Animated.Text>

      {/* Tagline */}
      <Animated.Text style={[sp.tagline, { opacity: tagOpacity }]}>
        Smart Payroll · Modern Teams
      </Animated.Text>

      {/* Bottom bar */}
      <Animated.View style={[sp.bottomBar, { transform: [{ scaleX: barScale }] }]}>
        <View style={sp.bottomBarFill} />
      </Animated.View>
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
  logoGlow: {
    position: 'absolute',
    width: 130, height: 130, borderRadius: 65,
    backgroundColor: PRIMARY,
  },
  logoBox: {
    width: 88, height: 88, borderRadius: 26,
    backgroundColor: PRIMARY,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: PRIMARY, shadowOpacity: 0.9, shadowRadius: 30, elevation: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    marginBottom: 30,
  },
  appName: {
    fontSize: 42, fontWeight: '900', color: '#F0F0FF',
    letterSpacing: -1.5, marginBottom: 10,
  },
  tagline: {
    fontSize: 13, fontWeight: '500',
    color: 'rgba(240,240,255,0.35)', letterSpacing: 1.5,
    textTransform: 'uppercase', marginBottom: 60,
  },
  bottomBar: {
    position: 'absolute', bottom: H * 0.1,
    width: 48, height: 3, borderRadius: 2, overflow: 'hidden',
  },
  bottomBarFill: {
    flex: 1, backgroundColor: PRIMARY, borderRadius: 2,
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
          'Outfit-Regular': 'https://cdn.jsdelivr.net/npm/@fontsource/outfit@5.0.17/files/outfit-latin-400-normal.ttf',
          'Outfit-Medium': 'https://cdn.jsdelivr.net/npm/@fontsource/outfit@5.0.17/files/outfit-latin-500-normal.ttf',
          'Outfit-SemiBold': 'https://cdn.jsdelivr.net/npm/@fontsource/outfit@5.0.17/files/outfit-latin-600-normal.ttf',
          'Outfit-Bold': 'https://cdn.jsdelivr.net/npm/@fontsource/outfit@5.0.17/files/outfit-latin-700-normal.ttf',
          'Outfit-ExtraBold': 'https://cdn.jsdelivr.net/npm/@fontsource/outfit@5.0.17/files/outfit-latin-800-normal.ttf',
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

  return (
    <ErrorBoundary>
      <NotificationProvider>
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
      </NotificationProvider>
    </ErrorBoundary>
  );
}
