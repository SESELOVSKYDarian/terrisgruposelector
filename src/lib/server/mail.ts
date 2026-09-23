import "server-only";

import { createTransport } from "nodemailer";
import { Resend } from "resend";

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Falta RESEND_API_KEY.");
  return new Resend(apiKey);
}

/**
 * SMTP transport for a real mailbox you already own (e.g. no-reply@tudominio.com via el webmail
 * del hosting). No domain verification needed in a third party: the mailbox's own mail server
 * already has its DKIM/SPF sorted out. Cached across invocations; nodemailer pools connections.
 */
let smtpTransport: ReturnType<typeof createTransport> | null = null;
function getSmtpTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) throw new Error("Faltan SMTP_HOST, SMTP_USER o SMTP_PASSWORD.");
  if (!smtpTransport) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    smtpTransport = createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth: { user, pass },
      // Temporary: some hosting mail servers run with an expired/self-signed cert. Skipping
      // verification means the connection is no longer protected against impersonation, so this
      // is meant only until the host renews it — never the default, always opt-in.
      tls: process.env.SMTP_ALLOW_INVALID_CERT === "true" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return smtpTransport;
}

export function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

/** SMTP wins when configured (it's your own mailbox: no sandbox restrictions); Resend is the fallback. */
export async function sendMail(to: string, subject: string, html: string) {
  const from = process.env.EMAIL_FROM ?? "PR Territorios <no-responder@resend.dev>";
  if (smtpConfigured()) {
    await getSmtpTransport().sendMail({ from, to, subject, html });
    return;
  }
  const { error } = await getResend().emails.send({ from, to, subject, html });
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
    <p style="font-size:14px;color:#444">Pediste restablecer tu contraseña en PR Territorios.</p>
    <p><a href="${link}" style="display:inline-block;background:#5e6ad2;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Elegir nueva contraseña</a></p>
    <p style="font-size:12px;color:#888">El link vence en 30 minutos. Si no fuiste vos, ignora este mail.</p>
  </div>`;
}
