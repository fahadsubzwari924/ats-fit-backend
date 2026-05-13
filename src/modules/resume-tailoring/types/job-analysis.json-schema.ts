export const JobAnalysisJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'position',
    'technical',
    'experience',
    'qualifications',
    'context',
    'keywords',
    'metadata',
  ],
  properties: {
    position: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'level', 'department', 'workType'],
      properties: {
        title: { type: 'string' },
        level: {
          type: 'string',
          enum: ['junior', 'mid', 'senior', 'lead', 'principal', 'director'],
        },
        department: { type: 'string' },
        workType: {
          type: 'string',
          enum: ['remote', 'hybrid', 'onsite', 'flexible'],
        },
      },
    },
    technical: {
      type: 'object',
      additionalProperties: false,
      required: [
        'mandatorySkills',
        'preferredSkills',
        'programmingLanguages',
        'frameworks',
        'tools',
        'databases',
        'cloudPlatforms',
        'methodologies',
      ],
      properties: {
        mandatorySkills: { type: 'array', items: { type: 'string' } },
        preferredSkills: { type: 'array', items: { type: 'string' } },
        programmingLanguages: { type: 'array', items: { type: 'string' } },
        frameworks: { type: 'array', items: { type: 'string' } },
        tools: { type: 'array', items: { type: 'string' } },
        databases: { type: 'array', items: { type: 'string' } },
        cloudPlatforms: { type: 'array', items: { type: 'string' } },
        methodologies: { type: 'array', items: { type: 'string' } },
      },
    },
    experience: {
      type: 'object',
      additionalProperties: false,
      required: [
        'minimumYears',
        'maximumYears',
        'industryPreferences',
        'domainExperience',
      ],
      properties: {
        minimumYears: { type: 'number' },
        maximumYears: { type: 'number' },
        industryPreferences: { type: 'array', items: { type: 'string' } },
        domainExperience: { type: 'array', items: { type: 'string' } },
      },
    },
    qualifications: {
      type: 'object',
      additionalProperties: false,
      required: ['education', 'certifications', 'softSkills', 'leadership'],
      properties: {
        education: {
          type: 'object',
          additionalProperties: false,
          required: ['required', 'preferred'],
          properties: {
            required: { type: 'array', items: { type: 'string' } },
            preferred: { type: 'array', items: { type: 'string' } },
          },
        },
        certifications: { type: 'array', items: { type: 'string' } },
        softSkills: { type: 'array', items: { type: 'string' } },
        leadership: { type: 'array', items: { type: 'string' } },
      },
    },
    context: {
      type: 'object',
      additionalProperties: false,
      required: [
        'companyStage',
        'teamSize',
        'reportingStructure',
        'keyResponsibilities',
        'successMetrics',
      ],
      properties: {
        companyStage: { type: 'string' },
        teamSize: { type: 'string' },
        reportingStructure: { type: 'string' },
        keyResponsibilities: { type: 'array', items: { type: 'string' } },
        successMetrics: { type: 'array', items: { type: 'string' } },
      },
    },
    keywords: {
      type: 'object',
      additionalProperties: false,
      required: ['primary', 'secondary', 'aliases'],
      properties: {
        primary: { type: 'array', items: { type: 'string' } },
        secondary: { type: 'array', items: { type: 'string' } },
        aliases: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['term', 'alternatives'],
            properties: {
              term: { type: 'string' },
              alternatives: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    metadata: {
      type: 'object',
      additionalProperties: false,
      required: ['complexity', 'competitiveness', 'confidenceScore'],
      properties: {
        complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
        competitiveness: { type: 'string', enum: ['low', 'medium', 'high'] },
        confidenceScore: { type: 'number' },
      },
    },
  },
};
