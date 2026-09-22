import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, Platform } from 'react-native';
// Web-only: react-native's <Modal> presents in its own top-level layer (a
// portal to document.body on web, a separate native window on iOS/Android),
// which paints above the normal JS view tree regardless of zIndex. A toast
// rendered in-tree — even with zIndex 9999 — gets trapped inside whatever
// `position: relative` ancestor happens to sit above it (SafeAreaProvider's
// wrapper, in this app), so it was silently invisible any time a form modal
// (leaves, requests, expense claims, etc.) was open and its validation
// failed. Portaling straight to document.body escapes that stacking context
// the same way Modal itself does. Native doesn't have this import available,
// so it keeps rendering in-tree there — a real native fix would need each
// Modal to render the toast itself, tracked separately.
const createPortal: ((children: React.ReactNode, container: Element) => React.ReactPortal) | null =
  Platform.OS === 'web' ? require('react-dom').createPortal : null;

type ToastType = 'success' | 'error' | 'warning' | 'info';

let _showToast: ((msg: string, type?: ToastType) => void) | null = null;

export function registerToast(fn: (msg: string, type?: ToastType) => void) {
  _showToast = fn;
}

export function showToast(msg: string, type: ToastType = 'info') {
  _showToast?.(msg, type);
}

const COLORS: Record<ToastType, string> = {
  success: '#22C55E',
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#00AEEF',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<{ id: number; msg: string; type: ToastType }[]>([]);
  const counter = useRef(0);

  useEffect(() => {
    registerToast((msg, type = 'info') => {
      const id = ++counter.current;
      setToasts((prev) => [...prev, { id, msg, type }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
    });
  }, []);

  const overlay = (
    <View style={styles.container} pointerEvents="none">
      {toasts.map((t) => (
        <ToastItem key={t.id} msg={t.msg} color={COLORS[t.type]} />
      ))}
    </View>
  );

  return (
    <>
      {children}
      {createPortal && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}
    </>
  );
}

function ToastItem({ msg, color }: { msg: string; color: string }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const native = Platform.OS !== 'web';
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: native }),
      Animated.delay(2400),
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: native }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.toast, { backgroundColor: color, opacity }]}>
      <Text style={styles.text}>{msg}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    right: 16,
    // react-native-web's <Modal> portal uses zIndex 2147483646 (max 32-bit
    // signed int) specifically so it always wins — now that the toast portals
    // to document.body too (see createPortal above), its zIndex competes
    // directly against Modal's in the same stacking context, so 9999 would
    // still lose. One higher than Modal's ceiling guarantees the toast wins.
    zIndex: 2147483647,
    gap: 8,
  },
  toast: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  text: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
});
