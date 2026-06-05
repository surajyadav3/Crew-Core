import React, { useEffect, useRef, createContext, useContext, useState, useCallback } from 'react';
import { Animated, Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type NotifType = 'success' | 'error' | 'info';

interface Notification {
  id: number;
  title: string;
  body: string;
  type: NotifType;
}

interface NotifContextType {
  notify: (title: string, body: string, type?: NotifType) => void;
}

const NotifContext = createContext<NotifContextType>({ notify: () => {} });

export function useNotification() {
  return useContext(NotifContext);
}

const ICON: Record<NotifType, string> = {
  success: 'checkmark-circle',
  error: 'close-circle',
  info: 'information-circle',
};

const COLOR: Record<NotifType, string> = {
  success: '#22C55E',
  error: '#EF4444',
  info: '#00AEEF',
};

let idCounter = 0;

function Banner({ notif, onDone }: { notif: Notification; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 200 }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => dismiss(), 4000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => onDone());
  };

  const color = COLOR[notif.type];

  return (
    <Animated.View
      style={[
        styles.banner,
        { top: insets.top + 10, transform: [{ translateY }], opacity },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: color }]} />
      <View style={[styles.iconWrap, { backgroundColor: color + '20' }]}>
        <Ionicons name={ICON[notif.type] as any} size={22} color={color} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>{notif.title}</Text>
        <Text style={styles.body} numberOfLines={2}>{notif.body}</Text>
      </View>
      <TouchableOpacity onPress={dismiss} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={16} color="#94A3B8" />
      </TouchableOpacity>
    </Animated.View>
  );
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Notification[]>([]);

  const notify = useCallback((title: string, body: string, type: NotifType = 'info') => {
    const id = ++idCounter;
    setQueue((prev) => [...prev.slice(-1), { id, title, body, type }]);
  }, []);

  const remove = useCallback((id: number) => {
    setQueue((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return (
    <NotifContext.Provider value={{ notify }}>
      {children}
      {queue.map((notif) => (
        <Banner key={notif.id} notif={notif} onDone={() => remove(notif.id)} />
      ))}
    </NotifContext.Provider>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingRight: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
    zIndex: 9999,
    overflow: 'hidden',
  },
  accent: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginLeft: 4,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  title: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  body: { fontSize: 12, color: '#64748B', marginTop: 2 },
  closeBtn: { padding: 2 },
});
