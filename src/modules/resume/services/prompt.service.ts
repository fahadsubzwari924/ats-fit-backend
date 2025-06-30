// resume.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ResumeAnalysis } from '../interfaces/resume-extracted-keywords.interface';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

@Injectable()
export class PromptService {
  private readonly logger = new Logger(PromptService.name);

  constructor() {}

  // prompt.service.ts
  getTailoredResumePrompt(
    originalResumeText: string,
    jobDescription: string,
    companyName: string,
    analysis: ResumeAnalysis,
  ): string {
    try {
      this.validateTailoredResumeInputs(
        originalResumeText,
        jobDescription,
        companyName,
        analysis,
      );

      return `
You are an expert resume writer tasked with transforming a candidate's resume into a tailored, quantifiable, and job-specific version. Your output MUST be valid JSON matching the specified structure.

**IMPORTANT WORK EXPERIENCE INSTRUCTION:**
- For the most recent job, include ALL bullet points (all responsibilities/achievements).
- For each older job, include UP TO 3 of the most relevant bullet points. If the original job has 3 or more, select the 3 most relevant to the job description. If fewer, include all.
- **Do NOT copy bullet points verbatim.** For each selected bullet point, tailor it to the job description and rewrite it as a quantifiable, measurable achievement (using the CAR method: Context, Action, Result).
- Example:
  - Original:
    - Managed X
    - Improved Y
    - Led Z
    - Automated W
  - Output (for older job):
    - Managed X (tailored and quantified)
    - Improved Y (tailored and quantified)
    - Led Z (tailored and quantified)

**Inputs:**
- Original Resume: ${originalResumeText}
- Job Description: ${jobDescription}
- Company: ${companyName}
- Analysis: Skill Match Score: ${analysis.skillMatchScore}, Missing Keywords: ${analysis.missingKeywords.slice(0, 5).join(', ')}

**Instructions:**
1. **Transform Responsibilities into Achievements:**
   - Convert every responsibility into a quantifiable achievement using the CAR method (Context, Action, Result).
   - Prioritize existing numbers in the resume; enhance with context.
   - For missing numbers, add realistic mid-range metrics (e.g., 25-50% improvement, $50K-$300K impact, 3-8 team members, 5K-25K users).
   - Tailor content to match job description keywords and focus areas.

2. **Work Experience Bullet Points:**
   - Latest job: Include all bullet points (all responsibilities/achievements).
   - Older jobs: Include up to 3 of the most relevant bullet points (see above for details).

3. **Summary and Skills:**
   - Write a quantifiable summary highlighting years of experience and key achievements.
   - Categorize skills into languages, frameworks, tools, databases, and concepts, aligning with job description.

4. **Output Requirements:**
   - Return valid JSON with the exact structure below.
   - Ensure every achievement includes a measurable metric (e.g., percentage, number, timeframe).
   - Rephrase original content to avoid verbatim copying; focus on job-specific enhancements.
   - Use realistic, mid-range estimates; avoid exaggeration.

**Output JSON Structure:**
{
  "title": "string",
  "contactInfo": {
    "name": "string",
    "email": "string",
    "phone": "string",
    "location": "string",
    "linkedin": "string",
    "portfolio": "string",
    "github": "string"
  },
  "summary": "string with quantifiable highlights",
  "skills": {
    "languages": ["string"],
    "frameworks": ["string"],
    "tools": ["string"],
    "databases": ["string"],
    "concepts": ["string"]
  },
  "experience": [{
    "company": "string",
    "position": "string",
    "duration": "string",
    "location": "string",
    "responsibilities": ["quantifiable achievement"],
    "achievements": ["quantifiable achievement"],
    "startDate": "string",
    "endDate": "string",
    "technologies": "string"
  }],
  "education": [{
    "institution": "string",
    "degree": "string",
    "major": "string",
    "startDate": "string",
    "endDate": "string"
  }],
  "certifications": [{
    "name": "string",
    "issuer": "string",
    "date": "string",
    "expiryDate": "string",
    "credentialId": "string"
  }],
  "additionalSections": [{
    "title": "string",
    "items": ["quantifiable item"]
  }]
}
`;
    } catch (error) {
      this.logger.error('Failed to generate tailored resume prompt', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to generate resume tailoring prompt',
        ERROR_CODES.PROMPT_GENERATION_FAILED,
      );
    }
  }

  getExtractKeywordsFromJobDescriptionPrompt(jobDescription: string): string {
    try {
      // Validate job description input
      this.validateJobDescriptionInput(jobDescription);

      return `
            Analyze this job description and extract:
            1. Hard skills required (programming languages, tools)
            2. Soft skills mentioned
            3. Key qualifications
            4. Any specific keywords that stand out
            
            Job Description:
            ${jobDescription}
            
            Return as JSON with keys: hardSkills, softSkills, qualifications, keywords
        `;
    } catch (error) {
      this.logger.error('Failed to generate keyword extraction prompt', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to generate keyword extraction prompt',
        ERROR_CODES.PROMPT_GENERATION_FAILED,
      );
    }
  }

  private validateTailoredResumeInputs(
    originalResumeText: string,
    jobDescription: string,
    companyName: string,
    analysis: ResumeAnalysis,
  ): void {
    // Validate original resume text
    if (!originalResumeText || typeof originalResumeText !== 'string') {
      throw new BadRequestException(
        'Original resume text is required and must be a string',
        ERROR_CODES.INVALID_RESUME_TEXT,
      );
    }

    if (originalResumeText.trim().length < 50) {
      throw new BadRequestException(
        'Original resume text must contain at least 50 characters',
        ERROR_CODES.INVALID_RESUME_TEXT,
      );
    }

    if (originalResumeText.length > 50000) {
      throw new BadRequestException(
        'Original resume text is too long (maximum 50,000 characters)',
        ERROR_CODES.INVALID_RESUME_TEXT,
      );
    }

    // Validate job description
    if (!jobDescription || typeof jobDescription !== 'string') {
      throw new BadRequestException(
        'Job description is required and must be a string',
        ERROR_CODES.INVALID_JOB_DESCRIPTION,
      );
    }

    if (jobDescription.trim().length < 20) {
      throw new BadRequestException(
        'Job description must contain at least 20 characters',
        ERROR_CODES.INVALID_JOB_DESCRIPTION,
      );
    }

    if (jobDescription.length > 10000) {
      throw new BadRequestException(
        'Job description is too long (maximum 10,000 characters)',
        ERROR_CODES.INVALID_JOB_DESCRIPTION,
      );
    }

    // Validate company name
    if (!companyName || typeof companyName !== 'string') {
      throw new BadRequestException(
        'Company name is required and must be a string',
        ERROR_CODES.INVALID_COMPANY_NAME,
      );
    }

    if (companyName.trim().length < 2) {
      throw new BadRequestException(
        'Company name must contain at least 2 characters',
        ERROR_CODES.INVALID_COMPANY_NAME,
      );
    }

    if (companyName.length > 100) {
      throw new BadRequestException(
        'Company name is too long (maximum 100 characters)',
        ERROR_CODES.INVALID_COMPANY_NAME,
      );
    }

    // Validate analysis object
    if (!analysis || typeof analysis !== 'object') {
      throw new BadRequestException(
        'Resume analysis is required and must be an object',
        ERROR_CODES.INVALID_ANALYSIS_DATA,
      );
    }

    if (
      typeof analysis.skillMatchScore !== 'number' ||
      analysis.skillMatchScore < 0 ||
      analysis.skillMatchScore > 1
    ) {
      throw new BadRequestException(
        'Skill match score must be a number between 0 and 1',
        ERROR_CODES.INVALID_ANALYSIS_DATA,
      );
    }

    if (!Array.isArray(analysis.missingKeywords)) {
      throw new BadRequestException(
        'Missing keywords must be an array',
        ERROR_CODES.INVALID_ANALYSIS_DATA,
      );
    }

    // Validate missing keywords array
    for (const keyword of analysis.missingKeywords) {
      if (typeof keyword !== 'string' || keyword.trim().length === 0) {
        throw new BadRequestException(
          'All missing keywords must be non-empty strings',
          ERROR_CODES.INVALID_ANALYSIS_DATA,
        );
      }
    }
  }

  private validateJobDescriptionInput(jobDescription: string): void {
    if (!jobDescription || typeof jobDescription !== 'string') {
      throw new BadRequestException(
        'Job description is required and must be a string',
        ERROR_CODES.INVALID_JOB_DESCRIPTION,
      );
    }

    if (jobDescription.trim().length < 20) {
      throw new BadRequestException(
        'Job description must contain at least 20 characters',
        ERROR_CODES.INVALID_JOB_DESCRIPTION,
      );
    }

    if (jobDescription.length > 10000) {
      throw new BadRequestException(
        'Job description is too long (maximum 10,000 characters)',
        ERROR_CODES.INVALID_JOB_DESCRIPTION,
      );
    }
  }
}
