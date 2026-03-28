import { Injectable, Logger } from '@nestjs/common';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../constants/error-codes';

@Injectable()
export class PromptService {
  private readonly logger = new Logger(PromptService.name);

  constructor() {}

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
   * Standard resume optimization: align resume to job (keywords, stack) without inventing facts.
   * Used when the user has no profile Q&A facts yet. Same JSON shape as precision path.
   */
  getResumeOptimizationPrompt(
    jobAnalysis: Record<string, any>,
    candidateContent: Record<string, any>,
    companyName: string,
    jobPosition: string,
  ): string {
    const technical = (jobAnalysis.technical as Record<string, any>) || {};
    const keywords = (jobAnalysis.keywords as Record<string, any>) || {};

    return `
You are an expert resume optimization specialist. Tailor the candidate's resume to the target job. Your output MUST be valid JSON matching the specified structure.

**CRITICAL RULE: ZERO HALLUCINATION (NO INVENTED METRICS)**
- Use ONLY facts, numbers, and metrics that already appear in the candidate resume JSON below
- NEVER invent, estimate, or assume quantifiable data (percentages, dollar amounts, counts, team sizes) that are not explicitly present in the resume
- You MAY rephrase, reorder, and emphasize existing content; you MAY align wording with job keywords when it truthfully reflects the candidate's experience
- If a bullet has no numbers in the source material, write a strong qualitative achievement — do NOT fabricate metrics
- Prefer a factual bullet without numbers over one with invented metrics

**CRITICAL WORK EXPERIENCE INSTRUCTION:**
- Extract and include ALL work experiences from the candidate's resume
- For the most recent job, include ALL bullet points
- For each older job, include UP TO 3 of the most relevant bullet points
- **Do NOT copy bullet points verbatim.** Rewrite for clarity and job alignment while obeying the ZERO HALLUCINATION policy above
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
1. **Achievements and responsibilities:**
   - Use CAR framing (Context, Action, Result) only with information that already exists in the resume
   - Mirror job-relevant keywords and tech stack where they match the candidate's stated experience
   - Do NOT add "realistic" or placeholder metrics

2. **Work experience:**
   - Latest job: include all bullet points
   - Older jobs: up to 3 most relevant bullets each
   - Every experience entry must have valid startDate and endDate

3. **Date format:**
   - Use "YYYY-MM-DD", "YYYY-MM", or "YYYY"; use "Present" for current roles
   - Never use "N/A" or invalid dates; infer dates only from explicit resume content

4. **Skills and summary:**
   - Summary must reflect real experience from the resume; no invented metrics
   - Include only skills present in the resume; prioritize ordering and grouping to match the job when truthful

**OUTPUT REQUIREMENTS:**
Return valid JSON with the EXACT structure below. Set achievementsQuantified to 0 if you did not introduce any new numeric claims beyond what was already in the resume.

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
    "summary": "string",
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
      "responsibilities": ["string"],
      "achievements": ["string"],
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
      "items": ["string"]
    }]
  },
  "optimizationMetrics": {
    "keywordsAdded": 5,
    "sectionsOptimized": 3,
    "achievementsQuantified": 0,
    "skillsAligned": 8,
    "confidenceScore": 85
  },
  "optimizationStrategy": {
    "primaryFocus": ["keyword integration", "factual alignment"],
    "improvementAreas": ["technical skills", "leadership experience"],
    "atsOptimizations": ["keyword density", "format standardization"],
    "recommendations": ["highlight relevant projects"]
  },
  "changesDiff": {
    "totalChanges": 5,
    "sectionsChanged": 3,
    "changes": [
      {
        "section": "Professional Summary",
        "changeType": "modified",
        "original": "original text here",
        "optimized": "optimized text here",
        "addedKeywords": ["React", "TypeScript"]
      }
    ]
  }
}

**CRITICAL VALIDATION REQUIREMENTS:**
- EVERY experience entry MUST have valid startDate and endDate fields
- NEVER use "N/A", "Unknown", or invalid values for dates
- Include ALL work experiences from candidate resume (don't skip any)
- Ensure experience array is complete and properly formatted
- Do NOT invent metrics; changesDiff.changes must cover ALL sections that were modified: Summary, Skills, and each Experience entry
- changeType must be one of: "modified", "added", "removed", "unchanged"
`;
  }

  /**
   * Precision / enhanced resume optimization: job alignment without inventing metrics.
   * Same JSON output shape as getResumeOptimizationPrompt; includes user-verified Q&A as source of truth.
   */
  getPrecisionOptimizationPrompt(
    jobAnalysis: Record<string, unknown>,
    candidateContent: Record<string, unknown>,
    companyName: string,
    jobPosition: string,
    verifiedFacts: Array<{ originalBulletPoint: string; userResponse: string }>,
  ): string {
    const technical = (jobAnalysis.technical as Record<string, unknown>) || {};
    const keywords = (jobAnalysis.keywords as Record<string, unknown>) || {};

    const factsBlock =
      verifiedFacts.length > 0
        ? verifiedFacts
            .map((f, i) => {
              const bullet = JSON.stringify(f.originalBulletPoint ?? '');
              const response = JSON.stringify(f.userResponse ?? '');
              return `${i + 1}. Original bullet: ${bullet}\n   User stated: ${response}`;
            })
            .join('\n\n')
        : '(No separate Q&A entries with text responses. Use only numbers and metrics explicitly present in the candidate JSON below.)';

    return `
You are an expert resume optimization specialist. Your task is to tailor a candidate's resume to the target job while preserving factual integrity. Your output MUST be valid JSON matching the specified structure.

**CRITICAL RULE: ZERO HALLUCINATION POLICY**
- Use ONLY facts, numbers, and metrics that appear in the candidate resume JSON below OR in the USER-VERIFIED FACTS section
- NEVER invent, estimate, round up, or assume quantifiable data (percentages, dollar amounts, counts, team sizes, timelines with numbers)
- If a bullet has no numbers in the source material, write a strong qualitative achievement — do NOT fabricate metrics
- Prefer a factual bullet without numbers over one with invented metrics
- Preserve approximate user phrasing (e.g. "about 30%") when given in USER-VERIFIED FACTS

**USER-VERIFIED FACTS (source of truth — preserve these exactly):**
${factsBlock}

Every number or metric listed under USER-VERIFIED FACTS was provided by the candidate. You MUST:
- Keep those figures exactly as stated (do not round, inflate, or rephrase numbers)
- Integrate them naturally into the relevant work experience bullets
- Not add additional metrics beyond what appears in the candidate content or USER-VERIFIED FACTS

**CRITICAL WORK EXPERIENCE INSTRUCTION:**
- Extract and include ALL work experiences from the candidate's resume
- For the most recent job, include ALL bullet points (all responsibilities/achievements)
- For each older job, include UP TO 3 of the most relevant bullet points
- **Do NOT copy bullet points verbatim.** Rewrite for clarity and job alignment while obeying the ZERO HALLUCINATION POLICY
- **MANDATORY DATE FIELDS:** Every experience entry MUST have valid startDate and endDate fields

**TARGET JOB INFORMATION:**
- Position: ${jobPosition}
- Company: ${companyName}
- Mandatory Skills: ${Array.isArray(technical.mandatorySkills) ? (technical.mandatorySkills as string[]).join(', ') : 'None specified'}
- Programming Languages: ${Array.isArray(technical.programmingLanguages) ? (technical.programmingLanguages as string[]).join(', ') : 'None specified'}
- Frameworks: ${Array.isArray(technical.frameworks) ? (technical.frameworks as string[]).join(', ') : 'None specified'}
- Primary Keywords: ${Array.isArray(keywords.primary) ? (keywords.primary as string[]).join(', ') : 'None specified'}

**CURRENT CANDIDATE RESUME (may already include merged user facts):**
${JSON.stringify(candidateContent, null, 2)}

**OPTIMIZATION INSTRUCTIONS:**
1. **Achievements and responsibilities:**
   - Align wording with the job description and keywords where truthful
   - Use the CAR method (Context, Action, Result) only with information that already exists — do not invent results
   - Do NOT add "realistic mid-range" or placeholder metrics

2. **Work experience:**
   - Latest job: include all bullet points
   - Older jobs: up to 3 most relevant bullets each
   - **CRITICAL:** Every experience entry must have valid startDate and endDate

3. **Date format:**
   - Use "YYYY-MM-DD", "YYYY-MM", or "YYYY"; use "Present" for current roles
   - Never use "N/A" or invalid dates; infer only from explicit resume content

4. **Skills and summary:**
   - Summary should reflect real experience from the resume; no invented metrics
   - Align skill categories with the job when those skills appear in the resume

**OUTPUT REQUIREMENTS:**
Return valid JSON with the EXACT structure below. Metrics in optimizationMetrics are estimates of what you changed — use 0 for achievementsQuantified if you did not add new numbers.

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
    "summary": "string",
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
      "responsibilities": ["string"],
      "achievements": ["string"],
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
      "items": ["string"]
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
    "primaryFocus": ["keyword integration", "factual alignment"],
    "improvementAreas": ["technical skills", "leadership experience"],
    "atsOptimizations": ["keyword density", "format standardization"],
    "recommendations": ["preserve user metrics", "highlight relevant projects"]
  },
  "changesDiff": {
    "totalChanges": 5,
    "sectionsChanged": 3,
    "changes": [
      {
        "section": "Professional Summary",
        "changeType": "modified",
        "original": "original text here",
        "optimized": "optimized text here",
        "addedKeywords": ["React", "TypeScript"]
      }
    ]
  }
}

**CRITICAL VALIDATION REQUIREMENTS:**
- EVERY experience entry MUST have valid startDate and endDate fields
- NEVER use "N/A", "Unknown", or invalid values for dates
- Include ALL work experiences from candidate resume
- Do not introduce new numerical claims
- changesDiff.changes must cover ALL sections that were modified: Summary, Skills, and each Experience entry
- changeType must be one of: "modified", "added", "removed", "unchanged"
`;
  }

  /**
   * Generate prompt for profile-level question generation (upload flow).
   * One question per vague bullet point; cap 9-12 total. No job description.
   */
  getProfileQuestionGenerationPrompt(
    bulletContexts: Array<{
      workExperienceIndex: number;
      bulletPointIndex: number;
      originalBulletPoint: string;
      positionTitle?: string;
    }>,
  ): string {
    const bulletsFormatted = bulletContexts
      .map(
        (b, i) =>
          `${i + 1}. [Experience ${b.workExperienceIndex}, Bullet ${b.bulletPointIndex}] "${b.originalBulletPoint}"${b.positionTitle ? ` (${b.positionTitle})` : ''}`,
      )
      .join('\n');

    return `
You are an expert resume consultant. For each resume bullet point below, generate exactly ONE question that will help the candidate provide the most impactful missing fact: a metric, scope, or outcome.

**Bullet points to question (already pre-selected; do not add more):**
${bulletsFormatted}

**RULES:**
- Generate exactly one question per bullet point above.
- Question should target: metric (numbers, %), scope (team size, users, scale), or outcome (result, impact).
- Use categories: metrics | impact | scope | technology | outcome.
- Keep questions conversational and easy to answer.
- Do not invent or assume; ask for what the candidate would know.

**RESPONSE FORMAT (JSON only):**
{
  "questions": [
    {
      "workExperienceIndex": 0,
      "bulletPointIndex": 0,
      "originalBulletPoint": "exact bullet text from above",
      "questionText": "One clear question for the candidate",
      "questionCategory": "metrics"
    }
  ]
}
`;
  }

  /**
   * Prompt for profile enrichment: merge answered profile questions into original
   * structured resume. No job description. Rewrite only bullets that have answers;
   * unanswered/skipped pass through unchanged. Zero hallucination.
   */
  getProfileEnrichmentPrompt(
    originalStructuredContentJson: string,
    questionsAndResponses: Array<{
      workExperienceIndex: number;
      bulletPointIndex: number;
      originalBulletPoint: string;
      questionText: string;
      userResponse: string;
    }>,
  ): string {
    const qrFormatted = questionsAndResponses
      .map(
        (qr, i) =>
          `${i + 1}. Experience[${qr.workExperienceIndex}] Bullet[${qr.bulletPointIndex}]: "${qr.originalBulletPoint}"\n   Q: ${qr.questionText}\n   A: ${qr.userResponse}`,
      )
      .join('\n\n');

    return `
You are an expert resume writer. Merge the user's factual answers into their resume structured content. There is NO job description; this is profile-level enrichment only.

**ZERO HALLUCINATION:** Use ONLY the facts from the user's responses. Never invent metrics or numbers. Unanswered bullets stay exactly as in the original.

**Original structured resume (JSON):**
${originalStructuredContentJson}

**User's answers (only these bullets should be rewritten):**
${qrFormatted}

**Instructions:**
1. For each bullet that has a user answer above: rewrite that single bullet using ONLY the user's stated facts (CAR method). Keep the same position in the same experience.
2. For all other bullets: output them UNCHANGED from the original JSON.
3. Keep contactInfo, summary, skills, education, certifications, additionalSections identical to the original unless a user answer clearly relates to them (rare).
4. Return valid JSON with the same structure as the original. Only the "experience[].achievements" array may differ for bullets that had answers.

**Output (JSON only):**
{
  "optimizedContent": { ... same shape as original experience/skills/contactInfo/summary/education/certifications/additionalSections ... }
}
`;
  }

  /**
   * Generate a targeted cover letter based on job analysis and candidate content.
   * Zero hallucination policy: only use facts present in the candidateContent or verifiedFacts.
   */
  getCoverLetterGenerationPrompt(
    jobAnalysis: Record<string, unknown>,
    candidateContent: Record<string, unknown>,
    companyName: string,
    jobPosition: string,
    verifiedFacts?: Array<{ originalBulletPoint: string; userResponse: string }>,
  ): string {
    const technical = (jobAnalysis.technical as Record<string, unknown>) ?? {};
    const keywords = (jobAnalysis.keywords as Record<string, unknown>) ?? {};
    const context = (jobAnalysis.context as Record<string, unknown>) ?? {};
    const contactInfo =
      (candidateContent.contactInfo as Record<string, unknown>) ?? {};
    const candidateName =
      typeof contactInfo.name === 'string' ? contactInfo.name : 'Candidate';

    const factsBlock =
      verifiedFacts && verifiedFacts.length > 0
        ? verifiedFacts
            .map(
              (f, i) =>
                `${i + 1}. ${JSON.stringify(f.originalBulletPoint)} → ${JSON.stringify(f.userResponse)}`,
            )
            .join('\n')
        : '(No separate Q&A facts provided — use only data present in the candidate resume.)';

    return `
You are an expert cover letter writer. Write a concise, impactful cover letter for the candidate below.
Keep it under 380 words. Avoid generic openers like "I am writing to express my interest in...".

**ZERO HALLUCINATION POLICY:** Only use facts, numbers, and achievements that are explicitly present in the CANDIDATE RESUME or USER-VERIFIED FACTS below. Never invent metrics.

**TARGET ROLE:**
- Position: ${jobPosition}
- Company: ${companyName}
- Mandatory Skills: ${Array.isArray(technical.mandatorySkills) ? (technical.mandatorySkills as string[]).join(', ') : 'Not specified'}
- Primary Keywords: ${Array.isArray(keywords.primary) ? (keywords.primary as string[]).join(', ') : 'Not specified'}
- Key Responsibilities: ${Array.isArray(context.keyResponsibilities) ? (context.keyResponsibilities as string[]).slice(0, 4).join('; ') : 'Not specified'}

**CANDIDATE RESUME:**
${JSON.stringify(candidateContent, null, 2)}

**USER-VERIFIED FACTS (source of truth):**
${factsBlock}

**WRITING GUIDELINES:**
1. Open with a strong hook that references the specific role and a concrete achievement from the resume
2. Body paragraph 1: Highlight 2-3 technical skills / achievements most relevant to the mandatory skills
3. Body paragraph 2: Show cultural / team fit or leadership (use resume evidence only)
4. Closing: Express genuine interest, reference company name specifically, and invite next steps
5. Professional but confident tone — avoid filler phrases
6. Reference specific job requirements by name (pulled from Primary Keywords / Mandatory Skills)

**OUTPUT (JSON only, no markdown outside the JSON block):**
{
  "coverLetter": {
    "greeting": "Dear Hiring Manager,",
    "opening": "string — 2-3 sentences, strong hook with a specific achievement",
    "body": [
      "string — paragraph 1, technical fit (2-4 sentences)",
      "string — paragraph 2, team/culture fit or leadership (2-3 sentences)"
    ],
    "closing": "string — 2 sentences expressing genuine interest and call to action",
    "signoff": "Sincerely,",
    "candidateName": "${candidateName}"
  },
  "metadata": {
    "keyThemesAddressed": ["string"],
    "toneProfile": "professional-confident",
    "wordCount": 0
  }
}
`;
  }
}
