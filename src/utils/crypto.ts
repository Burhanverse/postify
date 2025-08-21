import crypto from "crypto";

// AES-256-GCM encryption helper. Provide ENCRYPTION_KEY (32 bytes hex or base64).
const keyRaw = process.env.ENCRYPTION_KEY;
if (!keyRaw) {
  console.warn(
    "ENCRYPTION_KEY not set – encryption uses ephemeral key (dev mode).",
  );
}
const key = keyRaw
  ? keyRaw.length === 64 && /^[0-9a-f]+$/i.test(keyRaw)
    ? Buffer.from(keyRaw, "hex")
    : Buffer.from(keyRaw, "base64")
  : crypto.randomBytes(32);

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}
