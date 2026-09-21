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
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: { headers: { 'x-app-name': 'crewcore-mobile' } },
  }
);

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
