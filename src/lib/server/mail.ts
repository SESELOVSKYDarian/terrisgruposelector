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

function appOrigin() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://terrisgruposelector.vercel.app").replace(/\/$/, "");
}

/**
 * Shared frame for every transactional email: logo header, white card, plain-text-safe footer.
 * Table-based layout with inline styles only — the only markup that survives Outlook desktop
 * (Word rendering engine), Gmail's CSS stripping, and everything in between.
 */
function emailShell(bodyHtml: string) {
  const logo = `${appOrigin()}/pr-logo-email.png`;
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:32px 16px;background-color:#eef1f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;">
      <tr><td align="center" style="padding-bottom:20px;">
        <img src="${logo}" width="56" height="56" alt="PR Territorios" style="display:block;border-radius:12px;" />
      </td></tr>
      <tr><td style="background-color:#ffffff;border-radius:16px;padding:36px 32px;box-shadow:0 1px 3px rgba(16,24,40,0.08);">
        ${bodyHtml}
      </td></tr>
      <tr><td align="center" style="padding-top:24px;font-size:12px;line-height:18px;color:#8a94a6;">
        PR Territorios · gestión de territorios y salidas de la congregación<br />Este es un correo automático, no respondas a esta dirección.
      </td></tr>
    </table>
  </body>
</html>`;
}

export function otpEmailHtml(code: string) {
  return emailShell(`
    <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#5e6ad2;">Verificación de acceso</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:28px;color:#101828;">Tu código de PR Territorios</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#475467;">Usalo para terminar de iniciar sesión. Si no fuiste vos quien lo pidió, podés ignorar este correo con tranquilidad.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr><td align="center" style="background-color:#f4f5ff;border:1px solid #e0e3fa;border-radius:12px;padding:20px;">
        <span style="font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:#3730a3;">${code}</span>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#8a94a6;">Vence en 10 minutos.</p>
  `);
}

export function resetPasswordEmailHtml(link: string) {
  return emailShell(`
    <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#5e6ad2;">Restablecer contraseña</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:28px;color:#101828;">Pediste una nueva contraseña</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#475467;">Tocá el botón para elegir una contraseña nueva en PR Territorios. Si no fuiste vos, podés ignorar este correo: tu contraseña actual sigue funcionando.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr><td style="border-radius:10px;background-color:#5e6ad2;">
        <a href="${link}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Elegir nueva contraseña</a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#8a94a6;">El link vence en 30 minutos. Si el botón no funciona, copiá y pegá este link:<br /><a href="${link}" style="color:#5e6ad2;word-break:break-all;">${link}</a></p>
  `);
}
