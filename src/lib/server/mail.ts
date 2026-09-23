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
 * Shared frame for every transactional email: gradient header with the logo, white card that
 * overlaps it slightly (depth, without needing background images email clients might block),
 * plain-text-safe footer. Table-based layout with inline styles only — the subset that survives
 * Outlook desktop (Word rendering engine), Gmail's CSS stripping, and everything in between.
 */
function emailShell(kicker: string, title: string, bodyHtml: string) {
  const logo = `${appOrigin()}/pr-logo-email.png`;
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background-color:#eef1f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef1f6;">
      <tr><td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

          <tr><td align="center" style="background:linear-gradient(135deg,#5e6ad2,#4a3fb0);border-radius:20px 20px 0 0;padding:36px 32px 56px;">
            <img src="${logo}" width="52" height="52" alt="PR Territorios" style="display:block;border-radius:13px;box-shadow:0 4px 14px rgba(0,0,0,0.18);" />
            <p style="margin:14px 0 0;font-size:15px;font-weight:600;color:#ffffff;letter-spacing:0.01em;">PR Territorios</p>
          </td></tr>

          <tr><td style="background-color:#ffffff;border-radius:20px;margin-top:-40px;padding:0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:-40px;background-color:#ffffff;border-radius:20px;box-shadow:0 8px 28px rgba(16,24,40,0.12);">
              <tr><td style="padding:36px 32px 32px;">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#5e6ad2;">${kicker}</p>
                <h1 style="margin:0 0 18px;font-size:21px;line-height:28px;color:#101828;">${title}</h1>
                ${bodyHtml}
              </td></tr>
            </table>
          </td></tr>

          <tr><td align="center" style="padding:24px 16px 0;font-size:12px;line-height:19px;color:#8a94a6;">
            PR Territorios · gestión de territorios y salidas de la congregación<br />Este es un correo automático, no respondas a esta dirección.
          </td></tr>

        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function magicLinkUrl(magicToken: string) {
  return `${appOrigin()}/magic-login?token=${encodeURIComponent(magicToken)}`;
}

export function otpEmailHtml(code: string, magicToken?: string) {
  const link = magicToken ? magicLinkUrl(magicToken) : null;
  return emailShell(
    "Verificación de acceso",
    "Entrá a tu cuenta",
    `
    <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#475467;">Tocá el botón para entrar directo, o usá el código si preferís escribirlo a mano. Si no fuiste vos, ignorá este correo con tranquilidad.</p>
    ${
      link
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr><td align="center" style="border-radius:12px;background:linear-gradient(135deg,#5e6ad2,#4a3fb0);">
        <a href="${link}" style="display:block;padding:14px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Iniciar sesión</a>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="border-top:1px solid #eaecf0;"></td>
        <td width="1" style="white-space:nowrap;padding:0 12px;font-size:11px;color:#98a2b3;">O ESCRIBÍ EL CÓDIGO</td>
        <td style="border-top:1px solid #eaecf0;"></td>
      </tr></table>
    </td></tr></table>`
        : ""
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td align="center" style="background-color:#f7f8fc;border:1px solid #e4e7f5;border-radius:12px;padding:18px;">
        <span style="font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:9px;color:#3730a3;">${code}</span>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#8a94a6;">Vence en 10 minutos.</p>
  `,
  );
}

export function resetPasswordEmailHtml(link: string) {
  return emailShell(
    "Restablecer contraseña",
    "Pediste una nueva contraseña",
    `
    <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#475467;">Tocá el botón para elegir una contraseña nueva en PR Territorios. Si no fuiste vos, ignorá este correo: tu contraseña actual sigue funcionando.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr><td align="center" style="border-radius:12px;background:linear-gradient(135deg,#5e6ad2,#4a3fb0);">
        <a href="${link}" style="display:block;padding:14px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Elegir nueva contraseña</a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#8a94a6;">El link vence en 30 minutos. Si el botón no funciona, copiá y pegá este link:<br /><a href="${link}" style="color:#5e6ad2;word-break:break-all;">${link}</a></p>
  `,
  );
}
