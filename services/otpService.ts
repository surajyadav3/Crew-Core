import { supabase } from '@/lib/supabase';
import { phoneToPlaceholderEmail } from '@/lib/helpers';

export function detectIdentifierType(identifier: string): 'email' | 'phone' | null {
  const id = (identifier || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) return 'email';
  if (/^\d{10}$/.test(id)) return 'phone';
  return null;
}

/**
 * Supabase Auth is keyed by email. Employees imported with only a phone
 * number (no email) were given a Supabase Auth account under a deterministic
 * placeholder email — phoneToPlaceholderEmail(phone) — computed client-side
 * at account-creation time (see create-employee-user). Login re-derives that
 * same placeholder purely from the digits typed in; there's no DB lookup, so
 * this must stay byte-for-byte identical to the web app's resolveLoginEmail.
 */
export async function resolveLoginEmail(identifier: string): Promise<string> {
  const id = identifier.trim();
  if (id.includes('@')) return id.toLowerCase();
  // Validate the phone shape before synthesizing a placeholder — without this,
  // any digit-bearing typo (e.g. a partial number) silently became a bogus
  // placeholder address handed straight to signInWithPassword, trading a clear
  // validation error for a generic "Invalid login credentials".
  if (detectIdentifierType(id) !== 'phone') {
    throw new Error('Please enter a valid email address or 10-digit phone number.');
  }
  const placeholder = phoneToPlaceholderEmail(id);
  if (!placeholder) throw new Error('Please enter a valid email address or phone number.');
  return placeholder;
}

/** Clears the must_change_password flag after an employee sets their own password. Employees have no UPDATE policy on profiles, so this goes through a SECURITY DEFINER RPC. */
export async function clearMustChangePassword() {
  const { error } = await supabase.rpc('clear_must_change_password');
  return { error };
}

/**
 * Records the employee's current password in employee_current_passwords, a
 * table only superadmin can read. Called right after an employee sets their
 * own password for the first time, since profiles.temp_password is left
 * stale at that point on purpose (see 20260810_employee_current_password.sql).
 */
export async function recordCurrentPassword(password: string) {
  const { error } = await supabase.rpc('set_current_password', { p_password: password });
  return { error };
}

/**
 * Send a 6-digit OTP to the given email via the shared send-otp edge function
 * (custom otp_table + Nodemailer, not Supabase's built-in passwordless OTP) — the
 * same backend the website uses for both login and signup, so behavior (rate
 * limiting, expiry, delivery) matches exactly on both surfaces.
 */
export async function sendOtp(identifier: string, isSignup = false): Promise<{ type: string; identifier: string }> {
  const id = (identifier || '').trim();
  const type = detectIdentifierType(id);
  if (!type) throw new Error('Please enter a valid email address.');
  if (type !== 'email') throw new Error('Phone OTP is not supported. Please use email.');

  const resolvedId = id.toLowerCase();

  try {
    const { error } = await supabase.functions.invoke('send-otp', {
      body: { identifier: resolvedId, type: 'email', isSignup },
    });

    if (error) {
      let msg = error.message || '';
      try {
        const body = await (error as any).context?.clone().json();
        msg = body?.error || body?.message || msg;
      } catch (_) {}
      throw new Error(msg || 'Failed to send OTP. Please try again.');
    }

    return { type: 'email', identifier: resolvedId };
  } catch (err: any) {
    throw new Error(err.message || 'Failed to send OTP. Please try again.');
  }
}

/**
 * Verify the OTP token and perform the "Magic Bridge" login/signup.
 * For signup (isSignup=true): edge function atomically creates/updates the user,
 * sets the password, confirms the email, and returns { usePasswordLogin, user_id } —
 * we then sign in directly with the password the user just chose (no magic link).
 * For login (isSignup=false): edge function generates a magic link token_hash,
 * which we exchange for a real session below.
 */
export async function verifyOtp(
  identifier: string,
  token: string,
  isSignup = false,
  password?: string,
  firstName?: string,
  lastName?: string,
) {
  if (isSignup) {
    const requestBody: Record<string, unknown> = { identifier, otp: token, isSignup };
    if (password) requestBody.password = password;
    if (firstName) requestBody.firstName = firstName;
    if (lastName) requestBody.lastName = lastName;

    const { data, error } = await supabase.functions.invoke('verify-otp', { body: requestBody });

    if (error) {
      let msg = error.message;
      try {
        const body = await (error as any).context?.json();
        msg = body?.error || body?.message || msg;
      } catch (_) {}
      throw new Error(msg || 'OTP verification failed.');
    }

    // Edge function created/confirmed the user — sign in with the password they
    // just chose to get a real session (no magic link needed).
    if (data?.usePasswordLogin && password) {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: identifier,
        password,
      });
      if (authError) throw new Error(`Sign-in failed: ${authError.message}`);
      return authData;
    }

    if (data?.token_hash) {
      const { data: authData, error: authError } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash,
        type: 'magiclink',
      });
      if (authError) throw new Error(`Session login failed: ${authError.message}`);
      return authData;
    }

    throw new Error('Verification failed: no session token returned from server.');
  }

  // Login: verify against the same custom otp_table via the edge function, then
  // exchange the magic-link token_hash it returns for a real session.
  const { data, error } = await supabase.functions.invoke('verify-otp', {
    body: { identifier, otp: token, isSignup: false },
  });

  if (error) {
    let msg = error.message || '';
    try {
      const body = await (error as any).context?.clone().json();
      msg = body?.error || body?.message || msg;
    } catch (_) {}
    throw new Error(msg || 'OTP verification failed.');
  }

  if (!data?.token_hash) {
    throw new Error('Verification failed: no session token returned from server.');
  }

  const { data: authData, error: authError } = await supabase.auth.verifyOtp({
    token_hash: data.token_hash,
    type: 'magiclink',
  });
  if (authError) throw new Error(`Session Login Failed: ${authError.message}`);

  return authData;
}
