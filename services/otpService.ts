import { supabase } from '@/lib/supabase';

const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';

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

  const { data, error } = await supabase.functions.invoke('send-otp', {
    body: { identifier: id, type: 'email' },
    headers: { Authorization: `Bearer ${ANON_KEY}` },
  });

  if (error) {
    let msg = error.message;
    try {
      const body = await (error as any).context?.json();
      msg = body?.error || body?.message || msg;
    } catch (_) {}
    throw new Error(msg);
  }

  return { type: 'email', identifier: id };
}

export async function verifyOtp(identifier: string, token: string, isSignup = false, password?: string, firstName?: string, lastName?: string) {
  const requestBody: Record<string, unknown> = { identifier, otp: token, isSignup };
  if (isSignup) {
    if (password) requestBody.password = password;
    if (firstName) requestBody.firstName = firstName;
    if (lastName) requestBody.lastName = lastName;
  }

  const { data, error } = await supabase.functions.invoke('verify-otp', {
    body: requestBody,
    headers: { Authorization: `Bearer ${ANON_KEY}` },
  });

  if (error) {
    let msg = error.message;
    try {
      const body = await (error as any).context?.json();
      if (body?.error) msg = body.error;
      else if (body?.message) msg = body.message;
    } catch (_) {}
    throw new Error(msg || 'OTP verification failed.');
  }

  if (data?.usePasswordLogin && password) {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: identifier,
      password,
    });
    if (authError) throw new Error(`Sign-in failed: ${authError.message}`);
    return authData;
  }

  if (!data?.token_hash) throw new Error('Verification failed: no session token returned.');

  const { data: authData, error: authError } = await supabase.auth.verifyOtp({
    token_hash: data.token_hash,
    type: 'magiclink',
  });
  if (authError) throw new Error(`Session login failed: ${authError.message}`);
  return authData;
}
