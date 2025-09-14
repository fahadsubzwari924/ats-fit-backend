/**
 * Resume source strategy constants
 */
export enum ResumeSourceStrategy {
  /**
   * Guest user - always requires file upload
   */
  GUEST_FILE_REQUIRED = 'guest_file_required',

  /**
   * Registered user with existing processed resume - prefer database
   */
  REGISTERED_USE_EXISTING = 'registered_use_existing',

  /**
   * Registered user without processed resume - require file
   */
  REGISTERED_FILE_REQUIRED = 'registered_file_required',
}

/**
 * Resume source decision result
 */
export interface ResumeSourceDecision {
  strategy: ResumeSourceStrategy;
  reason: string;
  requiresFile: boolean;
  usesDatabase: boolean;
}
