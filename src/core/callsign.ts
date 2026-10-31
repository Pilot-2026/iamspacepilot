/** Words that must not appear in a public callsign (checked as parts of the name). */
const BLOCKED = [
  'fuck',
  'shit',
  'cunt',
  'nigg',
  'nazi',
  'hitler',
  'bitch',
  'whore',
  'porn',
  'penis',
  'vagina',
  'fick',
  'fotze',
  'hure',
  'wichs',
  'arschl',
  'schlampe',
  'nutte',
  'spast',
];

/** Callsign rules: 3 to 16 characters, letters, digits, - and _, nothing offensive. */
export function validateCallsign(raw: string): string | null {
  const s = raw.trim();
  if (s.length < 3) return 'Use at least 3 characters.';
  if (s.length > 16) return 'Use at most 16 characters.';
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return 'Use letters, numbers, - and _ only.';
  const lower = s.toLowerCase();
  if (BLOCKED.some((w) => lower.includes(w))) return 'Please choose a different callsign.';
  return null;
}
