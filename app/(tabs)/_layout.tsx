import { Tabs, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import { useApprovals } from '@/context/ApprovalsContext';
import ConnectingScreen from '@/components/ConnectingScreen';
import { View, Text, Image, Animated, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PRIMARY = '#6C5CE7';
const DARK = '#1A1B2E';
const MUTED = '#94A3B8';

function BrandedLoader() {
  const scale = useRef(new Animated.Value(0.8)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.08, duration: 800, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.92, duration: 800, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.5, duration: 800, useNativeDriver: true }),
        ]),
      ])
    ).start();

    // Ring pulsing
    const ringAnim = (anim: Animated.Value, delay: number) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: true }),
          ]),
          Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      ).start();
    };
    ringAnim(ring1, 0);
    ringAnim(ring2, 600);
  }, []);

  const ring1Scale = ring1.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.5] });
  const ring1Opacity = ring1.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.4, 0] });
  const ring2Scale = ring2.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.5] });
  const ring2Opacity = ring2.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.3, 0] });

  return (
    <View style={s.loaderBg}>
      {/* Rings */}
      <Animated.View style={[s.loadRing, { opacity: ring1Opacity, transform: [{ scale: ring1Scale }] }]} />
      <Animated.View style={[s.loadRing, { opacity: ring2Opacity, transform: [{ scale: ring2Scale }] }]} />

      <Animated.View style={[s.loaderLogo, { opacity, transform: [{ scale }] }]}>
        <Image source={require('@/assets/icon.png')} style={s.loaderLogoImg} resizeMode="contain" />
      </Animated.View>
      <Text style={s.loaderAppName}>CrewCore</Text>
      <Text style={s.loaderTagline}>Loading your workspace…</Text>

      <View style={s.loadingDots}>
        {[0, 1, 2].map((i) => <LoadingDot key={i} delay={i * 200} />)}
      </View>
    </View>
  );
}

function LoadingDot({ delay }: { delay: number }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 400, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={[s.dot, { opacity: anim }]} />
  );
}

export default function TabLayout() {
  const { user, profile, loading, profileStatus } = useAuth();
  const { isEnabled } = useFeatures();
  const { isApprover, total: pendingApprovals } = useApprovals();
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();

  const tabBarHeight = 66;

  // A superadmin can toggle individual features on/off per company from the
  // payroll web dashboard (see FeatureContext) — mirror the web sidebar's
  // behavior by hiding a tab when the feature it houses is disabled. The tab
  // bar itself only carries Home, Attendance, Leaves, (Team), Notices & Profile —
  // Requests, Performance and Payslips are reachable from Home's Quick
  // Actions / More Tools instead, to keep the bar from getting crowded.
  const hideAttendance = !isEnabled('attendance');
  const hideLeaves = !isEnabled('leave_requests');
  // Managers / HODs / Management / HR get a Team tab: their approvals inbox
  // (badge = requests waiting on them) and their team's day. Everyone else
  // never sees it.
  const hideTeam = !isApprover;

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login' as any);
    else if (!profile && profileStatus === 'missing') router.replace('/register' as any);
  }, [user, profile, loading, profileStatus]);

  if (loading) return <BrandedLoader />;
  if (user && !profile) return profileStatus === 'missing' ? <BrandedLoader /> : <ConnectingScreen />;

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: PRIMARY,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          height: tabBarHeight + Math.max(bottom, 0),
          paddingBottom: Math.max(bottom, 10),
          paddingTop: 8,
          borderTopWidth: 0,
          elevation: 10,
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarItemStyle: {
          height: tabBarHeight - 8,
          justifyContent: 'center',
          alignItems: 'center',
        },
      })}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'home' : 'home-outline'} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Attendance',
          href: hideAttendance ? null : undefined,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'finger-print' : 'finger-print-outline'} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="leaves"
        options={{
          title: 'Leaves',
          href: hideLeaves ? null : undefined,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'calendar' : 'calendar-outline'} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: 'Team',
          href: hideTeam ? null : undefined,
          tabBarBadge: pendingApprovals > 0 ? (pendingApprovals > 99 ? '99+' : pendingApprovals) : undefined,
          tabBarBadgeStyle: { backgroundColor: '#EF4444', fontSize: 10, fontWeight: '800' },
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'people' : 'people-outline'} color={color} focused={focused} />
          ),
        }}
      />
      {/* Requests, Performance & Payslips stay fully routable (Home's Quick
          Actions and More Tools link straight to them) but are dropped from
          the tab bar itself so it doesn't get overcrowded. */}
      <Tabs.Screen
        name="requests"
        options={{ title: 'Requests', href: null }}
      />
      <Tabs.Screen
        name="performance"
        options={{ title: 'Performance', href: null }}
      />
      <Tabs.Screen
        name="notices"
        options={{
          title: 'Notices',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'notifications' : 'notifications-outline'} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="payslips"
        options={{ title: 'Payslips', href: null }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'person-circle' : 'person-circle-outline'} color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

function TabIcon({ name, color, focused }: { name: any; color: string; focused: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const bgOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: focused ? 1.15 : 1,
        useNativeDriver: true,
        damping: 12,
        stiffness: 200,
      }),
      Animated.timing(bgOpacity, {
        toValue: focused ? 1 : 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [focused]);

  return (
    <View style={s.tabIconWrap}>
      <Animated.View style={[s.activeBg, { opacity: bgOpacity }]} />
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons name={name} size={24} color={focused ? PRIMARY : color} />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  loaderBg: {
    flex: 1, backgroundColor: DARK,
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  loadRing: {
    position: 'absolute',
    width: 90, height: 90, borderRadius: 45,
    borderWidth: 1.5, borderColor: PRIMARY,
  },
  loaderLogo: {
    width: 76, height: 76,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: PRIMARY, shadowOpacity: 0.5, shadowRadius: 20, elevation: 12,
    marginBottom: 4,
    zIndex: 1,
  },
  loaderLogoImg: { width: 76, height: 76 },
  loaderAppName: { fontSize: 30, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  loaderTagline: { fontSize: 13, color: 'rgba(255,255,255,0.4)', fontWeight: '500' },
  loadingDots: { flexDirection: 'row', gap: 6, marginTop: 8 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: PRIMARY },
  tabIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    width: 52,
    height: 42,
    borderRadius: 14,
  },
  activeBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(108, 92, 231, 0.08)',
    borderRadius: 14,
  },
});
