import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { normalizePrivateKey, normalizeServiceAccountEmail } from "../src/modules/s13/private-key";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

function canSign(key: string) {
  return createSign("RSA-SHA256").update("prueba").sign(key).length > 0;
}

const variants: Record<string, string> = {
  "con saltos de linea reales": privateKey,
  "con \\n literales": privateKey.trim().replace(/\n/g, "\\n"),
  "con \\n literales y comillas": `"${privateKey.trim().replace(/\n/g, "\\n")}"`,
  "con los saltos de linea convertidos en espacios": privateKey.trim().replace(/\n/g, " "),
  "con espacios y comillas": `"${privateKey.trim().replace(/\n/g, " ")}"`,
  "con CRLF": privateKey.replace(/\n/g, "\r\n"),
  "con espacios sobrantes alrededor": `   ${privateKey}   `,
  "todo en una sola linea sin separadores": privateKey.replace(/-----BEGIN PRIVATE KEY-----\n/, "-----BEGIN PRIVATE KEY-----").replace(/\n-----END PRIVATE KEY-----\n?/, "-----END PRIVATE KEY-----").replace(/\n/g, ""),
  "el JSON completo de la cuenta de servicio": JSON.stringify({ type: "service_account", client_email: "x@y.iam.gserviceaccount.com", private_key: privateKey }),
};

for (const [name, raw] of Object.entries(variants)) {
  test(`la clave privada ${name} se puede usar para firmar`, () => {
    assert.equal(canSign(normalizePrivateKey(raw)), true);
  });
}

test("sin normalizar, la clave con espacios en vez de saltos de linea falla como en produccion", () => {
  assert.throws(() => canSign(variants["con los saltos de linea convertidos en espacios"]), /DECODER|unsupported/i);
});

test("una clave truncada sigue fallando (no se disfraza)", () => {
  assert.throws(() => canSign(normalizePrivateKey(privateKey.slice(0, 200))));
});

test("el email de la cuenta de servicio se limpia de comillas y espacios", () => {
  assert.equal(normalizeServiceAccountEmail(' "cuenta@proyecto.iam.gserviceaccount.com" \n'), "cuenta@proyecto.iam.gserviceaccount.com");
});
