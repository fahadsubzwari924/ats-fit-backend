export const BETA_CODE_PREFIX = 'BETA-';

/**
 * Crockford base32 alphabet.
 * Excludes ambiguous characters: 0, O, 1, I, L, U
 */
export const BETA_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/** Number of data characters (excluding checksum) */
export const BETA_CODE_DATA_LENGTH = 7;

/** Number of checksum characters appended after data characters */
export const BETA_CODE_CHECKSUM_LENGTH = 1;
