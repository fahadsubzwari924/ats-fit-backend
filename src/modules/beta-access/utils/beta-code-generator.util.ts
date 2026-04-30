import * as crypto from 'crypto';
import {
  BETA_CODE_ALPHABET,
  BETA_CODE_DATA_LENGTH,
  BETA_CODE_PREFIX,
} from '../constants/beta-code.constant';

/**
 * Generates a cryptographically random beta invite code.
 * Format: BETA-<7 data chars><1 checksum char>  (13 chars total)
 */
export function generateBetaCode(): string {
  const bytes = crypto.randomBytes(BETA_CODE_DATA_LENGTH);
  const charIndices: number[] = [];

  for (let i = 0; i < BETA_CODE_DATA_LENGTH; i++) {
    charIndices.push(bytes[i] % BETA_CODE_ALPHABET.length);
  }

  const dataChars = charIndices.map((idx) => BETA_CODE_ALPHABET[idx]).join('');
  const checksumIndex = charIndices.reduce(
    (acc, idx) => (acc + idx) % BETA_CODE_ALPHABET.length,
    0,
  );
  const checksumChar = BETA_CODE_ALPHABET[checksumIndex];

  return `${BETA_CODE_PREFIX}${dataChars}${checksumChar}`;
}

/**
 * Validates the checksum character of a beta code.
 * Returns false if the format is wrong or checksum does not match.
 */
export function validateBetaCodeChecksum(code: string): boolean {
  if (!code.startsWith(BETA_CODE_PREFIX)) {
    return false;
  }

  const payload = code.slice(BETA_CODE_PREFIX.length);

  if (payload.length !== BETA_CODE_DATA_LENGTH + 1) {
    return false;
  }

  const dataChars = payload.slice(0, BETA_CODE_DATA_LENGTH);
  const providedChecksum = payload[BETA_CODE_DATA_LENGTH];

  const charIndices = dataChars
    .split('')
    .map((ch) => BETA_CODE_ALPHABET.indexOf(ch));

  if (charIndices.some((idx) => idx === -1)) {
    return false;
  }

  const expectedIndex = charIndices.reduce(
    (acc, idx) => (acc + idx) % BETA_CODE_ALPHABET.length,
    0,
  );

  return BETA_CODE_ALPHABET[expectedIndex] === providedChecksum;
}
