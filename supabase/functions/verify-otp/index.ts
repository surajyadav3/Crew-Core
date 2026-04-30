import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { identifier, otp, isSignup, password, firstName, lastName } = await req.json()

    // 1. Verify OTP in database
    const { data: otpData, error: otpError } = await supabase
      .from('otp_table')
      .select('*')
      .eq('user_id', identifier)
      .eq('otp', otp)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (otpError || !otpData) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired OTP' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // 2. Clear OTP
    await supabase.from('otp_table').delete().eq('id', otpData.id)

    // 3. Handle Auth
    if (isSignup) {
      // Create user
      const { data: userData, error: userError } = await supabase.auth.admin.createUser({
        email: identifier,
        password: password || Math.random().toString(36).slice(-12),
        email_confirm: true,
        user_metadata: { first_name: firstName, last_name: lastName }
      })

      if (userError) throw userError

      // Generate magic link token_hash for immediate login
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: identifier,
      })

      if (linkError) throw linkError

      return new Response(
        JSON.stringify({ message: 'User created', token_hash: linkData.properties.token_hash }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    } else {
      // Existing user login
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: identifier,
      })

      if (linkError) throw linkError

      return new Response(
        JSON.stringify({ token_hash: linkData.properties.token_hash }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
