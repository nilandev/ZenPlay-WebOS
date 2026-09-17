/**
 * Hashes a parental-control PIN with SHA-256 via the Web Crypto API, which
 * webOS TV's WebKit runtime exposes as `crypto.subtle`. PINs are never
 * stored or compared in plaintext.
 */
export async function hashPin(pin: string): Promise<string> {
  const encoded = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return (await hashPin(pin)) === hash;
}
