import { Injectable, Logger } from '@nestjs/common';
import { LocalLlmService } from './local-llm.service';
import * as pdf from 'pdf-parse';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

export interface ExtractedResumeData {
  title: string;
  contactInfo: {
    name: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
    portfolio: string;
    github: string;
  };
  summary: string;
  skills: {
    languages: string[];
    frameworks: string[];
    tools: string[];
    databases: string[];
    concepts: string[];
  };
  experience: Array<{
    company: string;
    position: string;
    duration: string;
    location: string;
    responsibilities: string[];
    startDate: string;
    endDate: string;
    technologies: string;
  }>;
  education: Array<{
    institution: string;
    degree: string;
    major: string;
    startDate: string;
    endDate: string;
  }>;
  certifications: Array<{
    name: string;
    issuer: string;
    date: string;
    expiryDate: string;
    credentialId: string;
  }>;
  additionalSections: Array<{
    title: string;
    items: string[];
  }>;
}

export interface JobAnalysisData {
  requiredSkills: {
    hardSkills: string[];
    softSkills: string[];
    qualifications: string[];
    keywords: string[];
  };
  matchAnalysis: {
    skillMatchScore: number;
    missingKeywords: string[];
    strengths: string[];
    recommendations: string[];
  };
}

export interface ResumeAnalysisResult {
  // originalResumeText: string;
  extractedData: ExtractedResumeData;
  //   jobAnalysis: JobAnalysisData;
  metadata: {
    processingTime: number;
    modelUsed: string;
    // confidence: number;
  };
}

@Injectable()
export class LocalResumeAnalysisService {
  private readonly logger = new Logger(LocalResumeAnalysisService.name);
  private readonly SUPPORTED_MIME_TYPES = ['application/pdf'];

  constructor(private readonly localLlmService: LocalLlmService) {}

  /**
   * Analyze resume file and job description using local LLM
   */
  async analyzeResumeAndJobDescription(
    resumeFile: Express.Multer.File,
  ): Promise<ResumeAnalysisResult> {
    const startTime = Date.now();

    try {
      this.validateInputs(resumeFile);

      // Extract text from PDF
      const resumeText = await this.extractTextFromResume(resumeFile);

      if (!resumeText || resumeText.trim().length < 50) {
        throw new BadRequestException(
          'Unable to extract meaningful text from the resume file',
          ERROR_CODES.BAD_REQUEST,
        );
      }

      this.logger.debug('Resume text extracted successfully', {
        textLength: resumeText.length,
        firstChars: resumeText.substring(0, 100),
      });

      // Use JSON completion for structured extraction
      const extractedData = await this.extractResumeData(resumeText);

      const processingTime = Date.now() - startTime;

      return {
        extractedData,
        metadata: {
          processingTime,
          modelUsed: this.localLlmService.getModelName(),
        },
      };
    } catch (error) {
      this.logger.error('Resume analysis failed', error);
      throw error;
    }
  }

  /**
   * Extract structured data from resume text using local LLM
   */
  private async extractResumeData(
    resumeText: string,
  ): Promise<ExtractedResumeData> {
    const prompt = this.createResumeExtractionPrompt(resumeText);

    try {
      const response = await this.localLlmService.generateJsonCompletion(
        prompt,
        {
          temperature: 0.1,
          maxTokens: 10000, // Increased for resumes with many experiences/projects
          maxRetries: 3,
        },
      );

      // Validate completeness of the extracted data
      const extractedData = response as ExtractedResumeData;

      this.logger.debug('Resume data extraction successful');
      return extractedData;
    } catch (error) {
      this.logger.error('Failed to extract resume data', error);

      // Return a basic structure as fallback
      return this.createFallbackResumeData();
    }
  }

  /**
   * Create a prompt optimized for llama3 to extract resume data
   */
  private createResumeExtractionPrompt(resumeText: string): string {
    return `You are an expert resume parser. Extract structured information from the following resume text and return it as valid JSON.

CRITICAL INSTRUCTIONS:
- Extract the COMPLETE professional summary - every sentence, the entire paragraph(s)
- For job experience, extract ALL descriptions/bullet points into "responsibilities" field only for all job experience and do not skip any job experience
- Extract EVERY bullet point and detail completely - do not skip or truncate any information
- For missing information, use empty strings or empty arrays
- Ensure the JSON is valid and properly formatted
- Be thorough and extract ALL content

Resume text:
${resumeText}

Return the extracted information in the following JSON format:
{
  "title": "main professional title or role",
  "contactInfo": {
    "name": "full name",
    "email": "email address",
    "phone": "phone number", 
    "location": "location/address",
    "linkedin": "linkedin profile URL",
    "portfolio": "portfolio/website URL",
    "github": "github profile URL"
  },
  "summary": "COMPLETE professional summary - extract the ENTIRE paragraph(s), every sentence",
  "skills": {
    "languages": ["programming languages"],
    "frameworks": ["frameworks and libraries"], 
    "tools": ["tools and software"],
    "databases": ["databases"],
    "concepts": ["methodologies and concepts"]
  },
  "experience": [
    {
      "company": "company name",
      "position": "job title",
      "duration": "employment period",
      "location": "work location",
      "responsibilities": ["ALL job descriptions, bullet points, and details - extract EVERYTHING"],
      "startDate": "start date",
      "endDate": "end date",
      "technologies": "technologies used"
    }
  ],
  "education": [
    {
      "institution": "school/university name",
      "degree": "degree type",
      "startDate": "start date",
      "endDate": "end date"
    }
  ],
  "certifications": [
    {
      "name": "certification name",
      "issuer": "issuing organization",
    }
  ],
  "projects": [
    {
      "name": "project name",
      "description": "project description",
      "technologies": ["technologies used"],
      "achievements": ["project achievements"]
    }
  ],
  "additionalSections": [
    {
      "title": "section title",
      "items": ["section items"]
    }
  ]
}

IMPORTANT REMINDERS:
- Summary: Extract the COMPLETE summary paragraph - do not stop at 1-2 sentences
- Experience responsibilities: Include ALL bullet points and descriptions completely
- Extract every detail without skipping or summarizing`;
  }

  /**
   * Check if the extraction appears incomplete
   */
  private isExtractionIncomplete(result: unknown): boolean {
    if (!result || typeof result !== 'object') {
      return true;
    }

    const data = result as Record<string, unknown>;

    // Check for obvious signs of incomplete extraction
    const summaryTooShort =
      typeof data.summary === 'string' && data.summary.length < 100;
    const fewSkills =
      !Array.isArray(data.skills?.['frameworks']) ||
      data.skills['frameworks'].length < 3;
    const noCertifications =
      !Array.isArray(data.certifications) || data.certifications.length === 0;

    return summaryTooShort || fewSkills || noCertifications;
  }

  /**
   * Generate enhanced prompt for retry when initial extraction is incomplete
   */
  private getEnhancedExtractionPrompt(resumeText: string): string {
    return `
CRITICAL: The previous extraction was incomplete. This is a RETRY with MAXIMUM EMPHASIS on completeness.

You are an expert resume parser with ZERO TOLERANCE for incomplete data extraction. Your mission is to extract EVERY SINGLE PIECE of information from this resume.

**CRITICAL EXTRACTION REQUIREMENTS:**
🔍 SUMMARY: Extract the COMPLETE professional summary - every sentence, every detail
🔍 SKILLS: Extract EVERY framework mentioned (Angular, Node.js, Express.js, Nest.js, .NET Core, etc.)
🔍 SKILLS: Extract EVERY programming language, tool, database, and concept
🔍 EXPERIENCE: Extract ALL work experiences with complete details
🔍 CERTIFICATIONS: Extract ALL certifications - scan the entire document
🔍 EDUCATION: Extract ALL educational qualifications

**MANDATORY INSTRUCTIONS:**
- SCAN THE ENTIRE RESUME TEXT from beginning to end
- Do NOT truncate or summarize ANY content
- If you see "Angular, Node.js, Express.js, Nest.js, .NET Core" extract ALL of them
- If there are 4 certifications, extract ALL 4, not just the first one
- For summary: Include the COMPLETE paragraph(s), not just 1-2 sentences
- Use MAXIMUM attention to detail
- Return COMPLETE data structures for ALL sections

**Resume Text to Extract From:**
${resumeText}

**Return JSON with COMPLETE data (no truncation allowed):**
{
  "title": "string - professional title or objective",
  "contactInfo": {
    "name": "string - full name",
    "email": "string - email address", 
    "phone": "string - phone number",
    "location": "string - city, state/country",
    "linkedin": "string - LinkedIn URL",
    "portfolio": "string - portfolio URL",
    "github": "string - GitHub URL"
  },
  "summary": "string - COMPLETE professional summary (full text, no truncation)",
  "skills": {
    "languages": ["EVERY programming language mentioned"],
    "frameworks": ["EVERY framework: Angular, Node.js, Express.js, Nest.js, .NET Core, etc."],
    "tools": ["EVERY tool and software mentioned"],
    "databases": ["EVERY database mentioned"],
    "concepts": ["EVERY concept and methodology mentioned"]
  },
  "experience": [
    {
      "company": "string - company name",
      "position": "string - job title", 
      "duration": "string - employment duration",
      "location": "string - work location",
      "responsibilities": ["ALL responsibilities listed"],
      "achievements": ["ALL achievements listed"],
      "startDate": "string - start date",
      "endDate": "string - end date",
      "technologies": "string - comma-separated technologies"
    }
  ],
  "education": [
    {
      "institution": "string - school/university name",
      "degree": "string - degree type",
      "major": "string - field of study", 
      "startDate": "string - start date",
      "endDate": "string - graduation date"
    }
  ],
  "certifications": [
    {
      "name": "string - certification name",
      "issuer": "string - issuing organization",
      "date": "string - issue date",
      "expiryDate": "string - expiry date if any",
      "credentialId": "string - credential ID if any"
    }
  ],
  "additionalSections": [
    {
      "title": "string - section title",
      "items": ["ALL items in this section"]
    }
  ]
}

EXTRACT EVERYTHING - NO EXCEPTIONS!
`;
  }

  /**
   * Transform LLM result to match schema expectations
   */
  private transformLlmResult(result: unknown): unknown {
    if (!result || typeof result !== 'object') {
      return result;
    }

    const data = result as Record<string, unknown>;

    // Transform experience array to fix technologies field and filter out invalid entries
    if (Array.isArray(data.experience)) {
      data.experience = data.experience
        .filter((exp: unknown) => {
          // Filter out non-object entries (like the "education" string)
          return exp && typeof exp === 'object';
        })
        .map((exp: unknown) => {
          const expObj = exp as Record<string, unknown>;

          // Convert technologies array to string if needed
          if (Array.isArray(expObj.technologies)) {
            expObj.technologies = expObj.technologies.join(', ');
          }

          // Ensure all required fields are strings or arrays as expected
          return {
            company: typeof expObj.company === 'string' ? expObj.company : '',
            position:
              typeof expObj.position === 'string' ? expObj.position : '',
            duration:
              typeof expObj.duration === 'string' ? expObj.duration : '',
            location:
              typeof expObj.location === 'string' ? expObj.location : '',
            responsibilities: Array.isArray(expObj.responsibilities)
              ? expObj.responsibilities.map(String)
              : [],
            startDate:
              typeof expObj.startDate === 'string' ? expObj.startDate : '',
            endDate: typeof expObj.endDate === 'string' ? expObj.endDate : '',
            technologies:
              typeof expObj.technologies === 'string'
                ? expObj.technologies
                : '',
          };
        });
    }

    // Log data quality for debugging
    this.logDataQuality(data);

    return data;
  }

  /**
   * Log data quality metrics for debugging incomplete extractions
   */
  private logDataQuality(data: Record<string, unknown>): void {
    const quality = {
      summaryLength: typeof data.summary === 'string' ? data.summary.length : 0,
      skillsCount: {
        languages: Array.isArray(data.skills?.['languages'])
          ? data.skills['languages'].length
          : 0,
        frameworks: Array.isArray(data.skills?.['frameworks'])
          ? data.skills['frameworks'].length
          : 0,
        tools: Array.isArray(data.skills?.['tools'])
          ? data.skills['tools'].length
          : 0,
        databases: Array.isArray(data.skills?.['databases'])
          ? data.skills['databases'].length
          : 0,
      },
      experienceCount: Array.isArray(data.experience)
        ? data.experience.length
        : 0,
      educationCount: Array.isArray(data.education) ? data.education.length : 0,
      certificationsCount: Array.isArray(data.certifications)
        ? data.certifications.length
        : 0,
    };

    this.logger.debug('Data quality metrics:', quality);

    // Warn about potentially incomplete extractions
    if (quality.summaryLength < 100) {
      this.logger.warn(
        'Summary appears to be short - possible incomplete extraction',
      );
    }

    if (quality.skillsCount.frameworks < 3) {
      this.logger.warn(
        'Few frameworks extracted - possible incomplete extraction',
      );
    }

    if (quality.certificationsCount === 0) {
      this.logger.warn(
        'No certifications extracted - check if resume contains certifications',
      );
    }
  }

  /**
   * Analyze job description and perform matching with resume
   */
  private async analyzeJobDescriptionAndMatch(
    resumeText: string,
    jobDescription: string,
  ): Promise<JobAnalysisData> {
    const prompt = this.getJobAnalysisPrompt(resumeText, jobDescription);

    try {
      const result = await this.localLlmService.generateJsonCompletion(prompt);
      return result as JobAnalysisData;
    } catch (error) {
      this.logger.error(
        'Failed to analyze job description and matching',
        error,
      );
      throw new InternalServerErrorException(
        'Failed to analyze job description and perform matching',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Extract text from PDF resume
   */
  private async extractTextFromResume(
    file: Express.Multer.File,
  ): Promise<string> {
    try {
      if (file.mimetype === 'application/pdf') {
        const data = await pdf(file.buffer);
        return data.text;
      }

      throw new BadRequestException(
        'Unsupported file type',
        ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    } catch (error) {
      this.logger.error('PDF text extraction failed', error);
      throw new BadRequestException(
        'Failed to extract text from resume file',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  /**
   * Validate input parameters
   */
  private validateInputs(resumeFile: Express.Multer.File): void {
    if (!resumeFile) {
      throw new BadRequestException(
        'Resume file is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    if (!this.SUPPORTED_MIME_TYPES.includes(resumeFile.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type: ${resumeFile.mimetype}. Supported types: ${this.SUPPORTED_MIME_TYPES.join(', ')}`,
        ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }

    // if (!jobDescription || typeof jobDescription !== 'string') {
    //   throw new BadRequestException(
    //     'Job description is required',
    //     ERROR_CODES.INVALID_JOB_DESCRIPTION,
    //   );
    // }

    // if (jobDescription.trim().length < 20) {
    //   throw new BadRequestException(
    //     'Job description is too short',
    //     ERROR_CODES.INVALID_JOB_DESCRIPTION,
    //   );
    // }
  }

  /**
   * Calculate confidence score based on analysis quality
   */
  private calculateConfidence(
    extractedData: ExtractedResumeData,
    jobAnalysis: JobAnalysisData,
  ): number {
    let confidence = 0;

    try {
      // Check completeness of extracted data
      if (extractedData?.contactInfo?.name) confidence += 10;
      if (extractedData?.contactInfo?.email) confidence += 10;
      if (extractedData?.summary) confidence += 15;
      if (extractedData?.skills?.languages?.length > 0) confidence += 15;
      if (extractedData?.experience?.length > 0) confidence += 20;
      if (extractedData?.education?.length > 0) confidence += 10;

      // Check quality of job analysis
      if (jobAnalysis?.requiredSkills?.hardSkills?.length > 0) confidence += 10;
      if (jobAnalysis?.matchAnalysis?.skillMatchScore !== undefined)
        confidence += 10;
    } catch (error) {
      this.logger.warn('Error calculating confidence score', error);
      confidence = 50; // Default confidence
    }

    return Math.min(confidence, 100);
  }

  /**
   * Generate prompt for resume data extraction
   */
  private getResumeExtractionPrompt(resumeText: string): string {
    return `
You are an expert resume parser with a focus on COMPLETE and COMPREHENSIVE data extraction. Your task is to extract ALL structured information from the resume text without missing any details.

**CRITICAL INSTRUCTIONS:**
- Extract EVERY piece of information accurately - do not truncate or summarize
- For summary section: Extract the COMPLETE professional summary/objective paragraph(s) - include ALL sentences
- For skills section: Include EVERY single skill, framework, tool, database, and concept mentioned
- For experience section: Include ALL work experiences with COMPLETE details - if there are 5 experiences, extract ALL 5
- For education section: Include ALL educational qualifications and degrees
- For certifications section: Include EVERY certification mentioned - do not stop at the first one
- For projects section: Include ALL projects mentioned - if there are 12 projects, extract ALL 12, not just the first few
- Use empty strings or arrays only when information is truly not present
- Be thorough and comprehensive - missing information is unacceptable
- IMPORTANT: For "technologies" field in experience, provide a single comma-separated string, NOT an array
- IMPORTANT: Only include valid experience objects in the experience array, do not include other sections
- IMPORTANT: Return valid JSON only, no additional text or explanations
- SCAN THE ENTIRE RESUME: Make sure you read through the complete resume text to catch all details
- COUNT VERIFICATION: Count how many experiences/projects you see and extract that exact number

**QUALITY CHECKLIST:**
✓ Summary: Contains the full professional summary (not just 1-2 sentences)
✓ Skills: Contains ALL frameworks (Angular, Node.js, Express.js, Nest.js, .NET Core, etc.)
✓ Skills: Contains ALL programming languages mentioned
✓ Skills: Contains ALL tools and technologies mentioned
✓ Experience: Contains ALL work positions with complete details (verify count matches resume)
✓ Education: Contains ALL degrees and educational background
✓ Certifications: Contains ALL certifications (not just the first one)
✓ Projects: Contains ALL projects mentioned (verify count matches resume)

**Resume Text:**
${resumeText}

**Return JSON with this exact structure (ensure ALL data is captured):**
{
  "title": "string - professional title or objective",
  "contactInfo": {
    "name": "string - full name",
    "email": "string - email address",
    "phone": "string - phone number",
    "location": "string - city, state/country",
    "linkedin": "string - LinkedIn URL",
    "portfolio": "string - portfolio URL",
    "github": "string - GitHub URL"
  },
  "summary": "string - COMPLETE professional summary or objective (full paragraph(s), not truncated)",
  "skills": {
    "languages": ["array of ALL programming languages mentioned"],
    "frameworks": ["array of ALL frameworks and libraries (Angular, Node.js, Express.js, Nest.js, .NET Core, etc.)"],
    "tools": ["array of ALL tools and software mentioned"],
    "databases": ["array of ALL databases mentioned"],
    "concepts": ["array of ALL concepts and methodologies mentioned"]
  },
  "experience": [
    {
      "company": "string - company name",
      "position": "string - job title",
      "duration": "string - employment duration",
      "location": "string - work location",
      "responsibilities": ["array of ALL responsibilities listed"],
      "achievements": ["array of ALL achievements listed"],
      "startDate": "string - start date",
      "endDate": "string - end date",
      "technologies": "string - comma-separated technologies used"
    }
  ],
  "education": [
    {
      "institution": "string - school/university name",
      "degree": "string - degree type",
      "major": "string - field of study",
      "startDate": "string - start date",
      "endDate": "string - graduation date"
    }
  ],
  "certifications": [
    {
      "name": "string - certification name",
      "issuer": "string - issuing organization",
      "date": "string - issue date",
      "expiryDate": "string - expiry date if any",
      "credentialId": "string - credential ID if any"
    }
  ],
  "additionalSections": [
    {
      "title": "string - section title",
      "items": ["array of ALL items in this section"]
    }
  ]
}

REMEMBER: Extract EVERYTHING - completeness is critical!
`;
  }

  /**
   * Generate prompt for job analysis and matching
   */
  private getJobAnalysisPrompt(
    resumeText: string,
    jobDescription: string,
  ): string {
    return `
You are an expert career counselor and resume analyzer. Analyze the job description to extract requirements and then evaluate how well the resume matches those requirements.

**INSTRUCTIONS:**
- Extract all skills, qualifications, and requirements from the job description
- Analyze the resume against these requirements
- Provide a detailed matching analysis with actionable feedback
- Calculate a skill match score between 0 and 1
- Be thorough and provide specific recommendations

**Resume Text:**
${resumeText}

**Job Description:**
${jobDescription}

**Return JSON with this exact structure:**
{
  "requiredSkills": {
    "hardSkills": ["array of technical skills required"],
    "softSkills": ["array of soft skills required"],
    "qualifications": ["array of qualifications and requirements"],
    "keywords": ["array of important keywords from job description"]
  },
  "matchAnalysis": {
    "skillMatchScore": "number between 0 and 1 representing overall match",
    "missingKeywords": ["array of important missing skills/keywords"],
    "strengths": ["array of candidate's strengths for this role"],
    "recommendations": ["array of specific recommendations for improvement"]
  }
}

**Scoring Guidelines:**
- 0.9-1.0: Excellent match, highly qualified
- 0.8-0.89: Strong match, well qualified
- 0.7-0.79: Good match, qualified
- 0.6-0.69: Moderate match, some gaps
- Below 0.6: Weak match, significant gaps

Be realistic but fair in your assessment. Consider both explicit skills and transferable experience.
`;
  }

  /**
   * Generate optimized prompt specifically for nuextract model
   */
  private getOptimizedNuextractPrompt(resumeText: string): string {
    return `<|input|>
Extract structured information from this resume and return as JSON:

${resumeText}

<|output|>
{
  "title": "professional title",
  "contactInfo": {
    "name": "full name",
    "email": "email",
    "phone": "phone",
    "location": "location",
    "linkedin": "linkedin url",
    "portfolio": "portfolio url",
    "github": "github url"
  },
  "summary": "complete professional summary",
  "skills": {
    "languages": ["programming languages"],
    "frameworks": ["frameworks and libraries"],
    "tools": ["tools and software"],
    "databases": ["databases"],
    "concepts": ["concepts and methodologies"]
  },
  "experience": [
    {
      "company": "company name",
      "position": "job title",
      "duration": "employment period",
      "location": "work location",
      "responsibilities": ["key responsibilities"],
      "achievements": ["achievements"],
      "startDate": "start date",
      "endDate": "end date",
      "technologies": "comma-separated technologies"
    }
  ],
  "education": [
    {
      "institution": "school name",
      "degree": "degree type",
      "major": "field of study",
      "startDate": "start date",
      "endDate": "end date"
    }
  ],
  "certifications": [
    {
      "name": "certification name",
      "issuer": "issuing organization",
      "date": "issue date",
      "expiryDate": "expiry date if any",
      "credentialId": "credential id if any"
    }
  ],
  "additionalSections": [
    {
      "title": "section title",
      "items": ["section items"]
    }
  ]
}`;
  }

  /**
   * Create fallback resume data when extraction fails
   */
  private createFallbackResumeData(): ExtractedResumeData {
    return {
      title: '',
      contactInfo: {
        name: '',
        email: '',
        phone: '',
        location: '',
        linkedin: '',
        portfolio: '',
        github: '',
      },
      summary: '',
      skills: {
        languages: [],
        frameworks: [],
        tools: [],
        databases: [],
        concepts: [],
      },
      experience: [],
      education: [],
      certifications: [],
      additionalSections: [],
    };
  }
}
