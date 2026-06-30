import { supabase } from '@/lib/supabase';

export function detectIdentifierType(identifier: string): 'email' | 'phone' | null {
  const id = (identifier || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) return 'email';
  if (/^\d{10}$/.test(id)) return 'phone';
  return null;
}

export async function sendOtp(identifier: string): Promise<{ type: string; identifier: string }> {
  const id = identifier.trim().toLowerCase();
  const type = detectIdentifierType(id);
  if (!type) throw new Error('Please enter a valid email address.');
  if (type !== 'email') throw new Error('Phone OTP is not supported. Please use email.');

  const { error } = await supabase.auth.signInWithOtp({
    email: id,
    options: { shouldCreateUser: false },
  });

  if (error) {
    const msg = error.message?.toLowerCase() ?? '';
    if (
      msg.includes('not found') ||
      msg.includes('signup') ||
      msg.includes('user not found') ||
      msg.includes('invalid email')
    ) {
      throw new Error('No account found with this email. Please contact your admin.');
    }
    throw new Error(error.message || 'Failed to send OTP. Please try again.');
  }

  return { type: 'email', identifier: id };
}

export async function verifyOtp(
  identifier: string,
  token: string,
  isSignup = false,
  password?: string,
  firstName?: string,
  lastName?: string,
) {
  if (isSignup) {
    const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';
    const { data, error } = await supabase.functions.invoke('verify-otp', {
      body: { identifier, otp: token, isSignup, password, firstName, lastName },
      headers: { Authorization: `Bearer ${ANON_KEY}` },
    });

    if (error) {
      let msg = error.message;
      try {
        const body = await (error as any).context?.json();
        msg = body?.error || body?.message || msg;
      } catch (_) {}
      throw new Error(msg || 'OTP verification failed.');
    }

    if (data?.token_hash) {
      const { data: authData, error: authError } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash,
        type: 'magiclink',
      });
      if (authError) throw new Error(`Session login failed: ${authError.message}`);
      return authData;
    }

    return data;
  }

  // Login: verify 6-digit OTP using Supabase native auth
  const { data, error } = await supabase.auth.verifyOtp({
    email: identifier,
    token,
    type: 'email',
  });

  if (error) {
    const msg = error.message?.toLowerCase() ?? '';
    if (msg.includes('expired') || msg.includes('otp_expired')) {
      throw new Error('OTP has expired. Please request a new one.');
    }
    if (msg.includes('invalid') || msg.includes('otp_invalid')) {
      throw new Error('Invalid OTP. Please check and try again.');
    }
    throw new Error(error.message || 'OTP verification failed.');
  }

  return data;
}
