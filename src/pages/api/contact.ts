// src/pages/api/contact.ts
import type { APIRoute } from 'astro';
import { Resend } from 'resend';

const resend = new Resend(import.meta.env.RESEND_API_KEY);

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { name, email, message } = body;

        if (!name || !email || !message) {
            return new Response(
                JSON.stringify({ success: false, error: 'All fields are required.' }), 
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const response = await resend.emails.send({
            from: 'Rooted Moon Contact <contact@rootedmoonmedicinals.com>',
            to: [import.meta.env.PERSONAL_EMAIL],
            subject: `New Message from ${name}`,
            text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
            replyTo: email,
        });

        if (response.error) {
            return new Response(
                JSON.stringify({ success: false, error: response.error.message }), 
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ success: true }), 
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        return new Response(
            JSON.stringify({ success: false, error: 'Internal Server Error' }), 
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};