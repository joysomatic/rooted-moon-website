// src/pages/api/contact.ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

// Helper function to escape HTML special characters and prevent injection
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const POST: APIRoute = async ({ request }) => {
  // Set up a 5-second timeout guard to prevent hanging requests
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    // 1. Resolve environment variables safely across local dev & Cloudflare edge
    const apiKey = (env as any)?.RESEND_API_KEY || import.meta.env.RESEND_API_KEY;
    const recipientEmail = (env as any)?.PERSONAL_EMAIL || import.meta.env.PERSONAL_EMAIL;

    if (!apiKey) {
      clearTimeout(timeoutId);
      return new Response(
        JSON.stringify({ error: 'Missing RESEND_API_KEY environment variable.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!recipientEmail) {
      clearTimeout(timeoutId);
      return new Response(
        JSON.stringify({ error: 'Missing PERSONAL_EMAIL environment variable.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Multi-format Body Parsing
    let body: Record<string, any> = {};
    const contentType = (request.headers.get('content-type') || '').toLowerCase();

    try {
      if (contentType.includes('application/json')) {
        body = await request.json();
      } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await request.formData();
        body = Object.fromEntries(formData.entries());
      } else {
        const rawText = await request.text();
        if (rawText.trim()) {
          try {
            body = JSON.parse(rawText);
          } catch {
            const params = new URLSearchParams(rawText);
            body = Object.fromEntries(params.entries());
          }
        }
      }
    } catch {
      clearTimeout(timeoutId);
      return new Response(
        JSON.stringify({ error: 'Failed to parse request payload.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Extract and sanitize fields
    const senderName = escapeHtml(String(body.name || body.fullName || 'Anonymous'));
    const senderEmail = String(body.email || body.replyTo || '').trim();
    const rawSubject = String(body.subject || 'New Contact Form Submission');
    const rawMessage = String(body.message || 'No message content provided.');

    const cleanSubject = escapeHtml(rawSubject);
    const cleanMessage = escapeHtml(rawMessage).replace(/\n/g, '<br/>');

    // Build structured HTML email body
    const htmlPayload = `
      <div style="font-family: system-ui, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1e1b4b; margin-top: 0;">${cleanSubject}</h2>
        <p><strong>From:</strong> ${senderName} ${senderEmail ? `(&lt;${escapeHtml(senderEmail)}&gt;)` : ''}</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;" />
        <p style="white-space: pre-wrap; color: #334155; line-height: 1.6;">${cleanMessage}</p>
      </div>
    `;

    // Prepare Resend payload (using onboarding domain until custom domain is verified)
    const resendPayload: Record<string, any> = {
      from: 'Rooted Moon Contact <contact@rootedmoonmedicinals.com>',
      to: [recipientEmail],
      subject: rawSubject,
      html: htmlPayload,
    };

    // Include reply_to if a valid-looking sender email is provided
    if (senderEmail && senderEmail.includes('@')) {
      resendPayload.reply_to = senderEmail;
    }

    // 4. Dispatch request to Resend API with 5-second timeout signal
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(resendPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    let resendData: any = {};
    try {
      resendData = await resendResponse.json();
    } catch {
      resendData = { raw: await resendResponse.text() };
    }

    if (!resendResponse.ok) {
      return new Response(
        JSON.stringify({ error: resendData }),
        { status: resendResponse.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data: resendData }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    clearTimeout(timeoutId);
    const isTimeout = error.name === 'AbortError';
    return new Response(
      JSON.stringify({ 
        error: isTimeout ? 'Request timed out waiting for email provider.' : (error?.message || 'Internal Server Error') 
      }),
      { status: isTimeout ? 504 : 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};