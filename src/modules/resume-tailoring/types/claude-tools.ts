export const RETURN_OPTIMIZED_RESUME_TOOL = {
  name: 'return_optimized_resume',
  description:
    'Return the tailored resume content and optimization metrics as structured JSON.',
  input_schema: {
    type: 'object',
    properties: {
      optimizedContent: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          contactInfo: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              location: { type: 'string' },
              linkedin: { type: 'string' },
              portfolio: { type: 'string' },
              github: { type: 'string' },
            },
            required: [
              'name',
              'email',
              'phone',
              'location',
              'linkedin',
              'portfolio',
              'github',
            ],
          },
          summary: { type: 'string' },
          skills: {
            type: 'object',
            properties: {
              languages: { type: 'array', items: { type: 'string' } },
              frameworks: { type: 'array', items: { type: 'string' } },
              tools: { type: 'array', items: { type: 'string' } },
              databases: { type: 'array', items: { type: 'string' } },
              concepts: { type: 'array', items: { type: 'string' } },
            },
            required: [
              'languages',
              'frameworks',
              'tools',
              'databases',
              'concepts',
            ],
          },
          experience: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                company: { type: 'string' },
                position: { type: 'string' },
                duration: { type: 'string' },
                location: { type: 'string' },
                responsibilities: { type: 'array', items: { type: 'string' } },
                achievements: { type: 'array', items: { type: 'string' } },
                startDate: { type: 'string' },
                endDate: { type: 'string' },
                technologies: { type: 'string' },
              },
              required: [
                'company',
                'position',
                'duration',
                'location',
                'responsibilities',
                'achievements',
                'startDate',
                'endDate',
                'technologies',
              ],
            },
          },
          education: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                institution: { type: 'string' },
                degree: { type: 'string' },
                major: { type: 'string' },
                startDate: { type: 'string' },
                endDate: { type: 'string' },
              },
              required: [
                'institution',
                'degree',
                'major',
                'startDate',
                'endDate',
              ],
            },
          },
          certifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                issuer: { type: 'string' },
                date: { type: 'string' },
                expiryDate: { type: 'string' },
                credentialId: { type: 'string' },
              },
              required: [
                'name',
                'issuer',
                'date',
                'expiryDate',
                'credentialId',
              ],
            },
          },
          additionalSections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                items: { type: 'array', items: { type: 'string' } },
              },
              required: ['title', 'items'],
            },
          },
        },
        required: [
          'title',
          'contactInfo',
          'summary',
          'skills',
          'experience',
          'education',
          'certifications',
          'additionalSections',
        ],
      },
      optimizationMetrics: {
        type: 'object',
        properties: {
          keywordsAdded: { type: 'number' },
          sectionsOptimized: { type: 'number' },
          achievementsQuantified: { type: 'number' },
          skillsAligned: { type: 'number' },
          confidenceScore: { type: 'number' },
        },
        required: [
          'keywordsAdded',
          'sectionsOptimized',
          'achievementsQuantified',
          'skillsAligned',
          'confidenceScore',
        ],
      },
    },
    required: ['optimizedContent', 'optimizationMetrics'],
  } as Record<string, unknown>,
} satisfies {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export const RETURN_REWRITTEN_BULLETS_TOOL = {
  name: 'return_rewritten_bullets',
  description: 'Return rewritten bullet points as structured JSON.',
  input_schema: {
    type: 'object',
    properties: {
      rewrittenBullets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number' },
            bullet: { type: 'string' },
          },
          required: ['index', 'bullet'],
        },
      },
    },
    required: ['rewrittenBullets'],
  } as Record<string, unknown>,
} satisfies {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export const RETURN_COVER_LETTER_TOOL = {
  name: 'return_cover_letter',
  description: 'Return the generated cover letter as structured JSON.',
  input_schema: {
    type: 'object',
    properties: {
      coverLetter: {
        type: 'object',
        properties: {
          greeting: { type: 'string' },
          opening: { type: 'string' },
          body: { type: 'array', items: { type: 'string' } },
          closing: { type: 'string' },
          signoff: { type: 'string' },
          candidateName: { type: 'string' },
        },
        required: [
          'greeting',
          'opening',
          'body',
          'closing',
          'signoff',
          'candidateName',
        ],
      },
      metadata: {
        type: 'object',
        properties: {
          keyThemesAddressed: { type: 'array', items: { type: 'string' } },
          toneProfile: { type: 'string' },
          wordCount: { type: 'number' },
        },
        required: ['keyThemesAddressed', 'toneProfile', 'wordCount'],
      },
    },
    required: ['coverLetter', 'metadata'],
  } as Record<string, unknown>,
} satisfies {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};
