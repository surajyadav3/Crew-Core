import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "https://esm.sh/nodemailer@6.9.9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { identifier, type, isSignup } = await req.json();

    if (!identifier || !type) {
      return new Response(
        JSON.stringify({ error: "Missing 'identifier' or 'type'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (type !== "email") {
      return new Response(
        JSON.stringify({ error: "Only email OTP is supported." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const email = identifier.toLowerCase().trim();

    // Read SMTP secrets from environment — same Gmail relay the website uses
    // (Nodemailer), not the Resend API. A prior rewrite of this function moved
    // delivery to Resend without ever setting RESEND_API_KEY, which silently
    // broke OTP delivery for both the website and the mobile app (they share
    // this one deployed function). Reverting to the working SMTP path here.
    const smtpHost = Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
    const smtpPort = parseInt(Deno.env.get("SMTP_PORT") || "465");
    const smtpUser = Deno.env.get("SMTP_USER")!;
    const smtpPass = Deno.env.get("SMTP_PASS")!;
    const smtpFrom = Deno.env.get("SMTP_FROM") || `Crewcore <${smtpUser}>`;

    if (!smtpUser || !smtpPass) {
      console.error("SMTP_USER or SMTP_PASS environment variable is not set.");
      return new Response(
        JSON.stringify({ error: "Email service is not configured. Please contact the administrator." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Login and signup need opposite checks here: login requires a profile to
    // already exist (unchanged behavior), while signup — register.tsx's "Create
    // My Company" / "Join My Company" flow — sends this OTP *before* any
    // profile row exists (verify-otp is what creates it), so requiring one
    // upfront made every self-serve signup fail at step 1 with "No account
    // found". Signup instead checks the opposite: block re-sending an OTP for
    // an email that's already registered, so verify-otp's later createUser()
    // doesn't hit a confusing "already registered" error deeper in the flow.
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, email")
      .eq("email", email)
      .maybeSingle();

    if (profileError) throw profileError;

    if (isSignup) {
      if (profile) {
        return new Response(
          JSON.stringify({ error: "An account with this email already exists. Please sign in instead." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (!profile) {
      return new Response(
        JSON.stringify({ error: "No account found with this email. Please contact your admin." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Cooldown: this endpoint accepts any email (it's also used pre-signup, before
    // an account exists, so we can't check account ownership) — without a per-email
    // throttle it can be used to mass-mail arbitrary inboxes via our SMTP relay.
    const { data: recent } = await db
      .from("otp_table")
      .select("created_at")
      .eq("user_id", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent && Date.now() - new Date(recent.created_at).getTime() < 60_000) {
      return new Response(
        JSON.stringify({ error: "Please wait a minute before requesting another code." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await db.from("otp_table").delete().eq("user_id", email);
    const { error: insertErr } = await db.from("otp_table").insert([{
      user_id:    email,
      otp,
      expires_at: expiresAt,
    }]);

    if (insertErr) {
      console.error("otp_table insert error:", insertErr);
      return new Response(
        JSON.stringify({ error: "Failed to store OTP. " + insertErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send OTP email via Gmail SMTP
    const transporter = nodemailer.createTransport({
      host:   smtpHost,
      port:   smtpPort,
      secure: smtpPort === 465,
      auth:   { user: smtpUser, pass: smtpPass.replace(/\s/g, "") },
    });

    await transporter.sendMail({
      from:    smtpFrom,
      to:      email,
      subject: `${otp} is your Crewcore verification code`,
      html: `
        <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;background:#ffffff;">
          <div style="background:#0f172a;padding:28px 32px;border-radius:12px 12px 0 0;">
            <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">Crewcore</span>
          </div>
          <div style="padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
            <p style="color:#111827;font-size:16px;margin:0 0 4px;">Verify your identity</p>
            <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">Enter this code to continue signing in to Crewcore.</p>
            <div style="font-size:34px;font-weight:700;letter-spacing:8px;color:#0f172a;
                        background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;
                        padding:18px 20px;text-align:center;margin:0 0 20px;">
              ${otp}
            </div>
            <p style="color:#6b7280;font-size:13px;margin:0 0 24px;">This code expires in <strong>5 minutes</strong>. For your security, never share it with anyone — Crewcore staff will never ask for it.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;">
            <p style="color:#9ca3af;font-size:12px;margin:0;">Didn't request this code? You can safely ignore this email — no changes will be made to your account.</p>
          </div>
          <p style="color:#9ca3af;font-size:11px;text-align:center;margin:16px 0 0;">Crewcore &middot; This is an automated message, please do not reply.</p>
        </div>
      `,
    });

    return new Response(
      JSON.stringify({ success: true, type: "email" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("send-otp error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Failed to send OTP: " + message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
