/**
 * Invite-code utilities. Format: `XXX-XXXX` (3 + 4 chars).
 * Alphabet excludes ambiguous characters (0/O/1/I/L) so codes are
 * safe to read aloud and type without confusion.
 *
 * Search space: 30^7 ≈ 22 billion. Brute-forcing is infeasible at
 * the per-request rate Firestore allows, and invites carry an
 * expiresAt timestamp on top.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateInviteCode(): string {
  const part = (n: number) => {
    const out: string[] = [];
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    for (let i = 0; i < n; i++) out.push(ALPHABET[buf[i] % ALPHABET.length]);
    return out.join('');
  };
  return `${part(3)}-${part(4)}`;
}

/**
 * Normalise a user-typed code: uppercase, drop non-alphabet chars,
 * re-insert the dash after the third character.
 */
export function normaliseInviteCode(input: string): string {
  const cleaned = input.toUpperCase().split('').filter(c => ALPHABET.includes(c)).join('');
  if (cleaned.length <= 3) return cleaned;
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}`;
}

export function isCompleteCode(input: string): boolean {
  const norm = normaliseInviteCode(input);
  return /^[A-Z0-9]{3}-[A-Z0-9]{4}$/.test(norm);
}
