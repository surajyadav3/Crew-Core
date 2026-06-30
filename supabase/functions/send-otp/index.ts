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

    const { identifier, type } = await req.json()
    if (!identifier) throw new Error('Identifier is required')

    // 1. Validate user exists in profiles table
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', identifier)
      .maybeSingle()

    if (profileError) throw profileError
    if (!profile) {
      return new Response(
        JSON.stringify({ error: 'No account found with this email. Please contact your admin.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    // 2. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()

    // 3. Store in database (upsert by email)
    const { error: dbError } = await supabase
      .from('otp_table')
      .upsert({
        user_id: identifier,
        otp,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      }, { onConflict: 'user_id' })

    if (dbError) throw dbError

    // 4. Send email via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      console.error('RESEND_API_KEY is not set — OTP will not be delivered.')
      throw new Error('Email service is not configured. Please contact your admin.')
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'CrewCore <noreply@crewcore.app>',
        to: identifier,
        subject: 'Your CrewCore Login Code',
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #0B1F3A;">Your Login Code</h2>
            <p style="color: #475569;">Use the code below to sign in to CrewCore. It expires in 10 minutes.</p>
            <div style="background: #F0F9FF; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #00AEEF;">${otp}</span>
            </div>
            <p style="color: #94A3B8; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      }),
    })

    if (!emailRes.ok) {
      const emailError = await emailRes.json().catch(() => ({}))
      throw new Error(emailError?.message || `Email send failed: ${emailRes.status}`)
    }

    return new Response(
      JSON.stringify({ message: 'OTP sent successfully', identifier }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
