// resume.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ResumeAnalysis } from '../../modules/resume/interfaces/resume-extracted-keywords.interface';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../constants/error-codes';

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

  getAtsEvaluationPrompt(resumeText: string, jobDescription: string): string {
    return `
You are an advanced ATS (Applicant Tracking System) evaluator with expertise in resume analysis and job matching. Analyze the following resume against the job description and provide a comprehensive evaluation.

**CRITICAL INSTRUCTION:**
- Focus on SUBSTANCE over exact keyword matching
- A skill mentioned in the resume (even with different terminology) should be considered a match
- Consider context and experience level, not just exact word matches
- Be generous in recognizing relevant experience and skills

**Evaluation Criteria:**
1. **Technical Skills Match (40% weight)**: 
   - Look for skills mentioned in job description, even if terminology differs
   - Consider related technologies and frameworks
   - Weight recent experience more heavily
   - Recognize equivalent technologies (e.g., "NoSQL" includes MongoDB, "Cloud" includes AWS)

2. **Experience Relevance (25% weight)**:
   - Years of experience in relevant roles
   - Seniority level alignment
   - Project complexity and scale
   - Industry relevance

3. **Quantifiable Achievements (20% weight)**:
   - Number and quality of measurable accomplishments
   - Impact metrics and business value
   - Technical complexity demonstrated

4. **Soft Skills & Leadership (10% weight)**:
   - Team leadership, mentoring, collaboration
   - Communication and stakeholder management
   - Problem-solving and strategic thinking

5. **Resume Quality (5% weight)**:
   - Professional formatting and structure
   - Clear, concise descriptions
   - Proper contact information

**Resume:**
${resumeText}

**Job Description:**
${jobDescription}

**Return a JSON object with the following structure:**
{
  "requiredSectionsPresent": boolean,
  "contactInfo": {
    "emailPresent": boolean,
    "phonePresent": boolean,
    "linkedinPresent": boolean,
    "emailValid": boolean,
    "phoneValid": boolean
  },
  "chronology": {
    "gaps": [{"start": "YYYY-MM", "end": "YYYY-MM"}],
    "overlaps": [{"start": "YYYY-MM", "end": "YYYY-MM"}],
    "isReverseChronological": boolean
  },
  "seniorityMatch": string,
  "quantifiableAchievements": {
    "count": number,
    "examples": [string]
  },
  "softSkills": [string],
  "softSkillsMatch": [string],
  "redFlags": [string],
  "feedback": string,
  "overallScore": number (0-100),
  "strengths": [string],
  "weaknesses": [string],
  "recommendations": [string],
  "technicalSkillsMatch": {
    "matchedSkills": [string],
    "missingSkills": [string],
    "relatedSkills": [string]
  }
}

**Scoring Guidelines:**
- overallScore: 0-100 based on comprehensive evaluation
- 90-100: Excellent match, highly qualified
- 80-89: Strong match, well qualified
- 70-79: Good match, qualified
- 60-69: Moderate match, some concerns
- Below 60: Weak match, significant gaps
- Be realistic but fair in assessment
- Consider the candidate's potential, not just exact matches
- Provide specific, actionable feedback
`;
  }

  getPremiumAtsEvaluationPrompt(
    resumeText: string,
    jobDescription: string,
  ): string {
    return `
You are a premium ATS (Applicant Tracking System) evaluator with expertise in resume analysis and job matching. You are evaluating a resume against a job description using industry-standard ATS criteria.

**EVALUATION CRITERIA (Weighted Scoring):**

1. **Technical Skills Match (35% weight)**
   - Exact keyword matches and variations
   - Related technologies and frameworks
   - Skill relevance and recency
   - Technology stack alignment
   - Consider both explicit and implicit skill mentions

2. **Experience Alignment (25% weight)**
   - Years of experience vs requirements
   - Seniority level match
   - Industry relevance
   - Role progression and career trajectory
   - Project complexity and scale

3. **Quantifiable Achievements (20% weight)**
   - Number of measurable accomplishments
   - Impact metrics and business value
   - Technical complexity demonstrated
   - Results-driven outcomes
   - ROI and efficiency improvements

4. **Soft Skills & Leadership (15% weight)**
   - Team leadership and mentoring
   - Communication and collaboration
   - Problem-solving and strategic thinking
   - Stakeholder management
   - Cross-functional coordination

5. **Resume Quality (5% weight)**
   - Professional formatting
   - Clear and concise descriptions
   - Proper structure and organization
   - Contact information completeness
   - Grammar and presentation

**SCORING GUIDELINES:**
- 95-100: Exceptional match, highly qualified
- 90-94: Excellent match, well qualified
- 85-89: Strong match, qualified
- 80-84: Good match, mostly qualified
- 75-79: Moderate match, some concerns
- 70-74: Fair match, significant gaps
- Below 70: Weak match, major concerns

**Resume:**
${resumeText}

**Job Description:**
${jobDescription}

**Return a JSON object with the following structure:**
{
  "overallScore": number (0-100),
  "technicalSkillsScore": number (0-100),
  "experienceAlignmentScore": number (0-100),
  "achievementsScore": number (0-100),
  "softSkillsScore": number (0-100),
  "resumeQualityScore": number (0-100),
  "detailedBreakdown": {
    "technicalSkills": {
      "matched": ["skill1", "skill2", ...],
      "missing": ["skill1", "skill2", ...],
      "score": number (0-100),
      "reasoning": "string"
    },
    "experience": {
      "level": "string",
      "years": number,
      "relevance": number (0-100),
      "reasoning": "string"
    },
    "achievements": {
      "count": number,
      "quality": number (0-100),
      "impact": number (0-100),
      "reasoning": "string"
    },
    "softSkills": {
      "matched": ["skill1", "skill2", ...],
      "reasoning": "string"
    },
    "redFlags": ["flag1", "flag2", ...],
    "strengths": ["strength1", "strength2", ...],
    "weaknesses": ["weakness1", "weakness2", ...],
    "recommendations": ["recommendation1", "recommendation2", ...]
  },
  "confidence": number (0-100)
}

**IMPORTANT INSTRUCTIONS:**
- Be thorough and systematic in your evaluation
- Consider both explicit and implicit skill matches
- Provide specific, actionable feedback
- Maintain consistent scoring standards
- Consider the candidate's potential, not just exact matches
- Be realistic but fair in assessment
- Ensure all scores are between 0-100
- Provide detailed reasoning for each score component
- Focus on substance over exact keyword matching
- Recognize equivalent technologies and skills
`;
  }

  getExtractKeywordsFromJobDescriptionForAtsPrompt(
    jobDescription: string,
  ): string {
    try {
      // Validate job description input
      this.validateJobDescriptionInput(jobDescription);

      return `
You are an expert job description analyzer. Extract comprehensive skills and qualifications from the job description below.

**Instructions:**
1. **Hard Skills**: Extract specific technical skills, programming languages, tools, frameworks, databases, platforms, methodologies, and technologies mentioned.
2. **Soft Skills**: Extract interpersonal skills, communication abilities, leadership qualities, and behavioral competencies.
3. **Qualifications**: Extract educational requirements, certifications, years of experience, and specific qualifications.
4. **Keywords**: Extract any other important terms, industry-specific jargon, or buzzwords that would be relevant for ATS matching.

**Extraction Guidelines:**
- Be comprehensive but avoid duplicates
- Include variations of the same skill (e.g., "JavaScript" and "JS", "Node.js" and "NodeJS")
- Extract both explicit and implicit skills
- Include industry-standard terms even if not explicitly mentioned
- Prioritize skills that are most important for the role
- Include related technologies and frameworks
- Extract both specific tools and broader categories (e.g., "AWS" and "Cloud Computing")

**Special Considerations:**
- For cloud platforms, include both the platform name and specific services
- For databases, include both the database name and type (SQL/NoSQL)
- For testing, include both the tool and the testing type
- For DevOps, include both tools and methodologies
- For monitoring, include both tools and concepts

**Job Description:**
${jobDescription}

**Return Format (JSON):**
{
  "hardSkills": ["skill1", "skill2", "skill3", ...],
  "softSkills": ["skill1", "skill2", "skill3", ...],
  "qualifications": ["qualification1", "qualification2", ...],
  "keywords": ["keyword1", "keyword2", "keyword3", ...]
}

**Example:**
For a "Lead Back-end Engineer" role, you might extract:
- hardSkills: ["Node.js", "NodeJS", "MongoDB", "NoSQL", "AWS", "EC2", "Lambda", "S3", "VPC", "Redis", "RabbitMQ", "SQS", "Jest", "REST Assured", "Docker", "CI/CD", "GitHub Actions", "CodePipeline", "Load Balancing", "NewRelic", "Datadog", "CloudWatch", "Express", "Nest.js", "Fastify", "API Testing", "Postman", "TDD", "BDD", "Microservices", "Caching", "Concurrency", "Database Sharding", "Data Warehousing", "Prometheus"]
- softSkills: ["Leadership", "Mentoring", "Collaboration", "Team Management", "Problem Solving", "Strategic Thinking"]
- qualifications: ["Backend Development", "High-load Systems", "Message Queues", "Monitoring", "DevOps"]
- keywords: ["Backend", "API", "Scalable", "Performance", "Architecture", "System Design"]
`;
    } catch (error) {
      this.logger.error(
        'Failed to generate ATS keyword extraction prompt',
        error,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to generate ATS keyword extraction prompt',
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
    if (typeof companyName !== 'string') {
      throw new BadRequestException(
        'Company name must be a string',
        ERROR_CODES.INVALID_COMPANY_NAME,
      );
    }

    if (companyName && companyName.trim().length < 2) {
      throw new BadRequestException(
        'Company name must contain at least 2 characters',
        ERROR_CODES.INVALID_COMPANY_NAME,
      );
    }

    if (companyName && companyName.length > 100) {
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

  /**
   * Generate prompt for extracting structured content from resume text
   * This method creates a prompt focused solely on parsing and structuring resume content
   * without any job-specific analysis or matching
   *
   * @param resumeText - Raw text extracted from resume
   * @returns string - Formatted prompt for AI to extract structured content
   */
  getResumeContentExtractionPrompt(resumeText: string): string {
    return `
You are an expert resume parser. Extract and structure the following resume text into a comprehensive JSON format. Focus on accurately parsing all sections and information present in the resume without making assumptions about missing data.

**Instructions:**
1. Extract all personal/contact information
2. Parse work experience with dates, responsibilities, and achievements
3. Identify education, certifications, and skills
4. Structure additional sections like projects, volunteer work, etc.
5. Maintain original text context and meaning
6. Use consistent date formats (YYYY-MM-DD where possible)
7. Organize skills into logical categories

**Resume Text:**
${resumeText}

**Return a JSON object with the following exact structure:**
{
  "title": "Professional title/role (if mentioned)",
  "contactInfo": {
    "name": "Full name",
    "email": "email@example.com",
    "phone": "phone number",
    "location": "city, state/country",
    "linkedin": "LinkedIn URL (if present)",
    "portfolio": "Portfolio/website URL (if present)",
    "github": "GitHub URL (if present)"
  },
  "summary": "Professional summary or objective (if present)",
  "skills": {
    "languages": ["Programming languages"],
    "frameworks": ["Frameworks and libraries"],
    "tools": ["Software tools and platforms"],
    "databases": ["Database technologies"],
    "concepts": ["Technical concepts and methodologies"]
  },
  "experience": [
    {
      "company": "Company name",
      "position": "Job title",
      "duration": "Duration as written in resume",
      "location": "Work location",
      "startDate": "YYYY-MM-DD or YYYY-MM",
      "endDate": "YYYY-MM-DD or YYYY-MM or 'Present'",
      "responsibilities": ["List of responsibilities achievements if available"],
      "technologies": "Technologies used (if mentioned)"
    }
  ],
  "education": [
    {
      "institution": "School/University name",
      "degree": "Degree type and level",
      "startDate": "YYYY-MM-DD or YYYY",
      "endDate": "YYYY-MM-DD or YYYY or 'Present'"
    }
  ],
  "certifications": [
    {
      "name": "Certification name",
      "issuer": "Issuing organization",
      "date": "YYYY-MM-DD or YYYY-MM",
      "expiryDate": "YYYY-MM-DD (if applicable)",
      "credentialId": "ID number (if present)"
    }
  ],
  "additionalSections": [
    {
      "title": "Section name (e.g., Projects, Volunteer Work, Awards)",
      "items": ["List of items in this section"]
    }
  ]
}

**Important Notes:**
- If information is not present in the resume, use empty strings or empty arrays
- Preserve the original wording and context as much as possible  
- Extract dates in the most specific format available in the resume
- For skills, categorize them logically based on context
- Include all additional sections that don't fit standard categories
`;
  }

  /**
   * Generate comprehensive job description analysis prompt for GPT-4 Turbo
   * Extracts technical requirements, keywords, and context for resume optimization
   *
   * @param jobDescription - Raw job description text
   * @param jobPosition - Job position title
   * @param companyName - Company name
   * @returns string - Formatted prompt for comprehensive job analysis
   */
  getJobDescriptionAnalysisPrompt(
    jobDescription: string,
    jobPosition: string,
    companyName: string,
  ): string {
    return `
You are an expert job market analyst and ATS optimization specialist. Analyze the following job description comprehensively and extract all relevant information for resume tailoring and ATS optimization.

**Job Position:** ${jobPosition}
**Company:** ${companyName}

**Job Description:**
${jobDescription}

**Analysis Instructions:**
1. **Position Analysis**: Determine job level, department, and work arrangement
2. **Technical Requirements**: Categorize all technical skills by importance and type
3. **Experience Requirements**: Extract years of experience and domain knowledge
4. **Qualifications**: Separate required vs preferred education and certifications
5. **Context Analysis**: Understand company stage, team dynamics, and success metrics
6. **ATS Keywords**: Identify primary keywords most critical for ATS scoring
7. **Synonyms**: Map technical terms to their common alternatives

**Important Guidelines:**
- Be comprehensive but avoid duplication
- Prioritize explicit requirements over inferred ones
- Consider both technical and soft skill requirements
- Extract quantifiable metrics when mentioned
- Identify industry-specific terminology
- Consider modern vs legacy technology preferences

**Return Format (JSON):**
{
  "position": {
    "title": "string",
    "level": "junior|mid|senior|lead|principal|director",
    "department": "string",
    "workType": "remote|hybrid|onsite|flexible"
  },
  "technical": {
    "mandatorySkills": ["string"],
    "preferredSkills": ["string"],
    "programmingLanguages": ["string"],
    "frameworks": ["string"],
    "tools": ["string"],
    "databases": ["string"],
    "cloudPlatforms": ["string"],
    "methodologies": ["string"]
  },
  "experience": {
    "minimumYears": number,
    "maximumYears": number,
    "industryPreferences": ["string"],
    "domainExperience": ["string"]
  },
  "qualifications": {
    "education": {
      "required": ["string"],
      "preferred": ["string"]
    },
    "certifications": ["string"],
    "softSkills": ["string"],
    "leadership": ["string"]
  },
  "context": {
    "companyStage": "string",
    "teamSize": "string",
    "reportingStructure": "string",
    "keyResponsibilities": ["string"],
    "successMetrics": ["string"]
  },
  "keywords": {
    "primary": ["string"],
    "secondary": ["string"],
    "synonyms": {
      "keyword": ["synonym1", "synonym2"]
    }
  },
  "metadata": {
    "complexity": "low|medium|high",
    "competitiveness": "low|medium|high",
    "confidenceScore": number
  }
}

**Quality Standards:**
- Ensure all arrays contain relevant, non-duplicate items
- Confidence score should be 0-100 based on job description clarity
- Complexity based on technical requirements and responsibilities
- Competitiveness based on skill requirements and market demand
`;
  }

  /**
   * Generate comprehensive resume optimization prompt for Claude AI
   * Transforms candidate resume content based on job analysis and requirements
   *
   * @param jobAnalysis - Comprehensive job analysis result
   * @param candidateContent - Current resume content structure
   * @param companyName - Target company name
   * @param jobPosition - Target job position
   * @returns string - Formatted prompt for AI resume optimization
   */
  getResumeOptimizationPrompt(
    jobAnalysis: Record<string, any>,
    candidateContent: Record<string, any>,
    companyName: string,
    jobPosition: string,
  ): string {
    // Safely extract values with proper type checking
    const technical = (jobAnalysis.technical as Record<string, any>) || {};
    const keywords = (jobAnalysis.keywords as Record<string, any>) || {};

    return `
You are an expert resume optimization specialist. Your task is to transform a candidate's resume into a tailored, quantifiable, and job-specific version. Your output MUST be valid JSON matching the specified structure.

**CRITICAL WORK EXPERIENCE INSTRUCTION:**
- Extract and include ALL work experiences from the candidate's resume
- For the most recent job, include ALL bullet points (all responsibilities/achievements)
- For each older job, include UP TO 3 of the most relevant bullet points
- **Do NOT copy bullet points verbatim.** For each selected bullet point, tailor it to the job description and rewrite it as a quantifiable, measurable achievement
- **MANDATORY DATE FIELDS:** Every experience entry MUST have valid startDate and endDate fields

**TARGET JOB INFORMATION:**
- Position: ${jobPosition}
- Company: ${companyName}
- Mandatory Skills: ${Array.isArray(technical.mandatorySkills) ? technical.mandatorySkills.join(', ') : 'None specified'}
- Programming Languages: ${Array.isArray(technical.programmingLanguages) ? technical.programmingLanguages.join(', ') : 'None specified'}
- Frameworks: ${Array.isArray(technical.frameworks) ? technical.frameworks.join(', ') : 'None specified'}
- Primary Keywords: ${Array.isArray(keywords.primary) ? keywords.primary.join(', ') : 'None specified'}

**CURRENT CANDIDATE RESUME:**
${JSON.stringify(candidateContent, null, 2)}

**OPTIMIZATION INSTRUCTIONS:**
1. **Transform Responsibilities into Achievements:**
   - Convert every responsibility into a quantifiable achievement using the CAR method (Context, Action, Result)
   - Prioritize existing numbers in the resume; enhance with context
   - For missing numbers, add realistic mid-range metrics (e.g., 25-50% improvement, $50K-$300K impact, 3-8 team members)
   - Tailor content to match job description keywords and focus areas

2. **Work Experience Requirements:**
   - Latest job: Include all bullet points (all responsibilities/achievements)
   - Older jobs: Include up to 3 of the most relevant bullet points
   - **CRITICAL:** Every experience entry must have valid startDate and endDate fields in proper format

3. **Date Format Requirements:**
   - Use consistent date formats: "YYYY-MM-DD", "YYYY-MM", or "YYYY" 
   - For current positions, use "Present" as endDate
   - Never use "N/A" or invalid dates
   - If original dates are unclear, derive reasonable dates from context

4. **Skills and Summary:**
   - Write a quantifiable summary highlighting years of experience and key achievements
   - Categorize skills into languages, frameworks, tools, databases, and concepts
   - Align skills with job description requirements

**OUTPUT REQUIREMENTS:**
Return valid JSON with the EXACT structure below. Ensure every achievement includes measurable metrics.

{
  "optimizedContent": {
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
      "startDate": "string - MUST BE VALID DATE",
      "endDate": "string - MUST BE VALID DATE OR 'Present'",
      "technologies": "string"
    }],
    "education": [{
      "institution": "string",
      "degree": "string",
      "major": "string",
      "startDate": "string - MUST BE VALID DATE",
      "endDate": "string - MUST BE VALID DATE"
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
  },
  "optimizationMetrics": {
    "keywordsAdded": 5,
    "sectionsOptimized": 3,
    "achievementsQuantified": 10,
    "skillsAligned": 8,
    "confidenceScore": 85
  },
  "optimizationStrategy": {
    "primaryFocus": ["keyword integration", "achievement quantification"],
    "improvementAreas": ["technical skills", "leadership experience"],
    "atsOptimizations": ["keyword density", "format standardization"],
    "recommendations": ["add specific metrics", "highlight relevant projects"]
  }
}

**CRITICAL VALIDATION REQUIREMENTS:**
- EVERY experience entry MUST have valid startDate and endDate fields
- NEVER use "N/A", "Unknown", or invalid values for dates
- Include ALL work experiences from candidate resume (don't skip any)
- Ensure experience array is complete and properly formatted
- Use realistic, mid-range estimates for metrics; avoid exaggeration
`;
  }
}
