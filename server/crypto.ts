import { config } from "./config.ts";

const enc = new TextEncoder();

export function randomToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

export function randomId(): string {
  return randomToken(12);
}

export function randomCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
}

export function sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("base64url");
}

export function sign(value: string): string {
  return new Bun.CryptoHasher("sha256", config.secret).update(enc.encode(value)).digest("base64url").slice(0, 22);
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Signs a payload as `payload.signature`; payload must not contain dots. */
export function seal(payload: string): string {
  return `${payload}.${sign(payload)}`;
}

export function unseal(sealed: string): string | null {
  const i = sealed.lastIndexOf(".");
  if (i < 0) return null;
  const payload = sealed.slice(0, i);
  return safeEqual(sign(payload), sealed.slice(i + 1)) ? payload : null;
}
