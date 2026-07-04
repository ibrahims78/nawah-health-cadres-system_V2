import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const AUTH_TAG_LENGTH = 16;

function loadKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) {
    console.error(
      "❌ ENCRYPTION_KEY is not set. Refusing to start. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" " +
      "and save it in Replit Secrets."
    );
    process.exit(1);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
    console.error(
      "❌ ENCRYPTION_KEY must be exactly 64 hex characters (256-bit). " +
      "Generate a valid key with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
    process.exit(1);
  }
  return Buffer.from(envKey, "hex");
}

const KEY = loadKey();

export function encrypt(text: string): string {
  if (!text) return "";
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY.slice(0, 32), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decrypt(encryptedText: string): string {
  if (!encryptedText) return "";
  try {
    const buffer = Buffer.from(encryptedText, "base64");
    const iv       = buffer.subarray(0, 16);
    const authTag  = buffer.subarray(16, 32);
    const encrypted = buffer.subarray(32);
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY.slice(0, 32), iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final("utf8");
  } catch {
    return "";
  }
}
