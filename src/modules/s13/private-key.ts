/**
 * Turns whatever ended up in the GOOGLE_PRIVATE_KEY env var into a PEM Node can read.
 * Accepted: the key with real newlines, literal "\n", newlines collapsed into spaces (what a
 * single-line env field does to a pasted key), wrapped in quotes, CRLF, or the whole
 * service-account JSON pasted by mistake.
 */
export function normalizePrivateKey(raw: string) {
  let value = raw.trim();
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { private_key?: unknown };
      if (typeof parsed.private_key === "string") value = parsed.private_key;
    } catch {
      // not JSON: keep going with the raw text
    }
  }
  value = value.replace(/^["']+|["']+$/g, "").replace(/\\r/g, "").replace(/\\n/g, "\n").trim();
  const match = value.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (!match) return value;
  // Rebuild the PEM from its base64 body so stray spaces/line breaks can never break the decoder.
  const body = match[2].replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${match[1]}-----\n${lines.join("\n")}\n-----END ${match[1]}-----\n`;
}

/** Service-account emails are pasted with quotes or stray whitespace often enough to matter. */
export function normalizeServiceAccountEmail(raw: string) {
  return raw.trim().replace(/^["']+|["']+$/g, "").trim();
}
