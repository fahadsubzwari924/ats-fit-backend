import { UserType } from '../../database/entities/user.entity';

/**
 * Abstract interface for resume content operations
 *
 * This interface defines the contract for accessing resume content
 * without coupling to specific implementation details. It follows
 * the Interface Segregation Principle by exposing only the methods
 * needed by consuming modules.
 *
 * Benefits:
 * - Decouples modules from specific service implementations
 * - Enables easy testing through mocking
 * - Supports future implementation changes
 * - Clear contract definition for resume operations
 */
export interface IResumeContentProvider {
  /**
   * Check if a user type can use pre-processed resume feature
   *
   * @param userType - The type of user (guest, registered, premium)
   * @returns boolean indicating if feature is available
   */
  canUsePreProcessedResume(userType: UserType): boolean;

  /**
   * Get basic information about user's processed resume
   *
   * @param userId - The user ID to check
   * @returns Promise resolving to resume info or null if none exists
   */
  getUserProcessedResumeInfo(userId: string): Promise<{
    id: string;
    createdAt: Date;
    lastUsedAt: Date;
    usageCount: number;
  } | null>;
}
