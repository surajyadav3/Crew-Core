import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { largeSecureStore } from '@/lib/secureStorage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

if (__DEV__ && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn('[CrewCore] EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is not set. Check your .env file.');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      storage: largeSecureStore,
      // false on purpose — see "Token refresh ownership" below.
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: { headers: { 'x-app-name': 'crewcore-mobile' } },
  }
);

// Token refresh ownership: with autoRefreshToken: true, supabase-js on React
// Native starts its refresh ticker (and refreshes an expired token) the moment
// the client is created — in EVERY JS runtime, including the headless one the
// OS spins up for the Live Tracking background task. That runtime then raced
// the visible app over the same single-use refresh token, which Supabase
// rejects/revokes, logging the user out. Now only the visible app runs the
// ticker (AppState 'active' below + AuthProvider on mount); any runtime still
// refreshes on demand if it makes a request with an expired token.
//
// Supabase's token auto-refresh runs on a JS timer, which the OS freezes while
// the app is backgrounded. Without this, the access token silently expires
// while the app is in the background and the user gets bounced back to the
// login screen ("auto logged out") the next time they open it. Tying refresh
// to AppState is Supabase's own documented fix for React Native/Expo:
// https://supabase.com/docs/guides/auth/quickstarts/react-native
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

// AppState's 'change' event only fires on a *transition* (active <-> background),
// never for the app's initial state at cold launch — so without this, a device
// that's never been backgrounded since the process started has no refresh timer
// running at all, and a long-idle foreground session can expire silently.
if (AppState.currentState === 'active') {
  supabase.auth.startAutoRefresh();
}
