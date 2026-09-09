import "server-only";

export function getRpConfig(request: Request) {
  const url = new URL(request.url);
  const rpID = process.env.WEBAUTHN_RP_ID ?? url.hostname;
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;
  return { rpID, rpName: "PR Territorios", origin };
}
