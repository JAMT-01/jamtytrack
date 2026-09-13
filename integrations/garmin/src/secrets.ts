export async function seal(value: unknown, hex: string): Promise<string> {
  const key = await importKey(hex); const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('jamtytrack-garmin-v1')},
    key, new TextEncoder().encode(JSON.stringify(value)));
  return btoa(String.fromCharCode(...iv)) + '.' + btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
export async function unseal<T>(value: string, hex: string): Promise<T> {
  const [iv, encrypted] = value.split('.');
  const result = await crypto.subtle.decrypt({name: 'AES-GCM', iv: Uint8Array.from(atob(iv), c => c.charCodeAt(0)),
    additionalData: new TextEncoder().encode('jamtytrack-garmin-v1')}, await importKey(hex), Uint8Array.from(atob(encrypted), c => c.charCodeAt(0)));
  return JSON.parse(new TextDecoder().decode(result)) as T;
}
async function importKey(hex: string): Promise<CryptoKey> {
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('Garmin encryption is not configured');
  return crypto.subtle.importKey('raw', Uint8Array.from(hex.match(/../g)!, byte => parseInt(byte,16)), {name: 'AES-GCM'}, false, ['encrypt','decrypt']);
}
export async function authorized(request: Request, secret: string): Promise<boolean> {
  if (!secret || secret.length < 32) return false;
  const supplied = request.headers.get('authorization') || '';
  // HMAC verification avoids comparing secret strings and accepts only our
  // dedicated service credential, never the user's Garmin password/session.
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign','verify']);
  const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('Bearer ' + secret));
  return crypto.subtle.verify('HMAC', key, expected, new TextEncoder().encode(supplied));
}
