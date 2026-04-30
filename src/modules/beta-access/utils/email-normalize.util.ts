/**
 * Normalizes an email address to lower-case trimmed form for consistent
 * case-insensitive comparisons.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}
