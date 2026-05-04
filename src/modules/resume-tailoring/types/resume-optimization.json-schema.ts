/**
 * JSON Schema Draft 7 definition for the resume optimization AI response.
 *
 * Used with OpenAI's `response_format: { type: 'json_schema', json_schema: { strict: true } }`
 * to guarantee structured output from the fallback model.
 *
 * Shape mirrors `ResumeOptimizationResult` (minus `processingMetadata`, which is added
 * programmatically) — specifically the `optimizedContent` (TailoredContent) and
 * `optimizationMetrics` (OptimizationMetrics) fields.
 */
export const ResumeOptimizationJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['optimizedContent', 'optimizationMetrics'],
  properties: {
    optimizedContent: {
      type: 'object',
      additionalProperties: false,
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
      properties: {
        title: { type: 'string' },
        contactInfo: {
          type: 'object',
          additionalProperties: false,
          required: [
            'name',
            'email',
            'phone',
            'location',
            'linkedin',
            'portfolio',
            'github',
          ],
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            location: { type: 'string' },
            linkedin: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            portfolio: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            github: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
        summary: { type: 'string' },
        skills: {
          type: 'object',
          additionalProperties: false,
          required: [
            'languages',
            'frameworks',
            'tools',
            'databases',
            'concepts',
          ],
          properties: {
            languages: { type: 'array', items: { type: 'string' } },
            frameworks: { type: 'array', items: { type: 'string' } },
            tools: { type: 'array', items: { type: 'string' } },
            databases: { type: 'array', items: { type: 'string' } },
            concepts: { type: 'array', items: { type: 'string' } },
          },
        },
        experience: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
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
            properties: {
              company: { type: 'string' },
              position: { type: 'string' },
              duration: { type: 'string' },
              location: { type: 'string' },
              responsibilities: { type: 'array', items: { type: 'string' } },
              achievements: {
                type: 'array',
                items: { type: 'string' },
                description: 'Always return as empty array []',
              },
              startDate: { type: 'string' },
              endDate: { type: 'string' },
              technologies: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            },
          },
        },
        education: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'institution',
              'degree',
              'major',
              'startDate',
              'endDate',
            ],
            properties: {
              institution: { type: 'string' },
              degree: { type: 'string' },
              major: { type: 'string' },
              startDate: { type: 'string' },
              endDate: { type: 'string' },
            },
          },
        },
        certifications: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'issuer', 'date', 'expiryDate', 'credentialId'],
            properties: {
              name: { type: 'string' },
              issuer: { type: 'string' },
              date: { type: 'string' },
              expiryDate: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              credentialId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            },
          },
        },
        additionalSections: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'items'],
            properties: {
              title: { type: 'string' },
              items: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    optimizationMetrics: {
      type: 'object',
      additionalProperties: false,
      required: [
        'keywordsAdded',
        'sectionsOptimized',
        'achievementsQuantified',
        'skillsAligned',
        'confidenceScore',
      ],
      properties: {
        keywordsAdded: { type: 'number' },
        sectionsOptimized: { type: 'number' },
        achievementsQuantified: { type: 'number' },
        skillsAligned: { type: 'number' },
        confidenceScore: { type: 'number' },
      },
    },
  },
};
