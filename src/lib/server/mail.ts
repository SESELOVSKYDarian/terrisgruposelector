import "server-only";

import { Resend } from "resend";

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Falta RESEND_API_KEY.");
  return new Resend(apiKey);
}

export async function sendMail(to: string, subject: string, html: string) {
  const from = process.env.EMAIL_FROM ?? "PR Territorios <no-responder@resend.dev>";
  const resend = getResend();
  const { error } = await resend.emails.send({ from, to, subject, html });
  if (error) throw new Error(error.message);
}

export function otpEmailHtml(code: string) {
  return `<div style="font-family:sans-serif;max-width:420px;margin:0 auto">
    <p style="font-size:14px;color:#444">Tu codigo de verificacion para PR Territorios es:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#1b1c1f">${code}</p>
    <p style="font-size:12px;color:#888">Vence en 10 minutos. Si no fuiste vos, ignora este mail.</p>
  </div>`;
}

export function resetPasswordEmailHtml(link: string) {
  return `<div style="font-family:sans-serif;max-width:420px;margin:0 auto">
    <p style="font-size:14px;color:#444">Pediste restablecer tu contrasena en PR Territorios.</p>
    <p><a href="${link}" style="display:inline-block;background:#5e6ad2;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Elegir nueva contrasena</a></p>
    <p style="font-size:12px;color:#888">El link vence en 30 minutos. Si no fuiste vos, ignora este mail.</p>
  </div>`;
}
