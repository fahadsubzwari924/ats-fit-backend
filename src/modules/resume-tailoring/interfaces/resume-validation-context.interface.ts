import { CommonValidationContext } from '../../../shared/modules/validation';

/**
 * Resume Generation Validation Context
 *
 * Extends the common validation context with resume-specific data.
 * This follows the Open/Closed principle - extending base functionality
 * without modifying it.
 */
export interface ResumeValidationContext extends CommonValidationContext {
  /**
   * Resume generation input data
   */
  input: {
    jobDescription: string;
    jobPosition: string;
    companyName: string;
    templateId: string;
    resumeId?: string;
    resumeFile?: Express.Multer.File;
  };

  /**
   * User context for resume operations
   */
  userContext: {
    userId?: string;
    guestId?: string;
    userType: 'guest' | 'freemium' | 'premium';
  };

  /**
   * Available services for validation rules
   */
  services?: {
    resumeSelectionService?: any;
    resumeTemplateService?: any;
  };
}
