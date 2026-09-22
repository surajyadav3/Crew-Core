import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { Colors as C } from '@/constants/Colors';

// Shared 6-box OTP input used by both login (OTP mode) and signup — the server
// always generates a 6-digit numeric code (send-otp / verify-otp edge functions),
// so this must stay in sync with that length.
export default function OtpBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<TextInput>(null);
  const digits = value.padEnd(6, ' ').split('').slice(0, 6);
  const boxAnims = useRef(Array.from({ length: 6 }, () => new Animated.Value(1))).current;

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const idx = Math.min(value.length, 5);
    if (value.length > 0) {
      Animated.sequence([
        Animated.timing(boxAnims[idx], { toValue: 1.12, duration: 100, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(boxAnims[idx], { toValue: 1, duration: 100, useNativeDriver: Platform.OS !== 'web' }),
      ]).start();
    }
  }, [value]);

  return (
    <TouchableOpacity
      style={s.otpRow}
      onPress={() => inputRef.current?.focus()}
      activeOpacity={1}
    >
      {digits.map((d, i) => (
        <Animated.View
          key={i}
          style={[
            s.otpBox,
            d.trim() ? s.otpBoxFilled : null,
            i === value.length && s.otpBoxActive,
            { transform: [{ scale: boxAnims[i] }] },
          ]}
        >
          <Text style={s.otpDigit}>{d.trim()}</Text>
        </Animated.View>
      ))}
      <TextInput
        ref={inputRef}
        style={s.otpHidden}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        caretHidden
      />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  otpRow: { flexDirection: 'row', gap: 7, justifyContent: 'center', marginBottom: 20 },
  otpBox: {
    width: 36, height: 48, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border,
    backgroundColor: '#FAFAFA', alignItems: 'center', justifyContent: 'center',
  },
  otpBoxFilled: { borderColor: C.primary, backgroundColor: C.primaryBg },
  otpBoxActive: { borderColor: C.primary, borderWidth: 2 },
  otpDigit: { fontSize: 18, fontWeight: '800', color: C.text },
  otpHidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
});
