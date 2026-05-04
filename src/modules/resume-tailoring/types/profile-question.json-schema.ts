export const ProfileQuestionJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['questionText', 'questionCategory'],
        properties: {
          questionText: { type: 'string' },
          questionCategory: {
            type: 'string',
            enum: ['metrics', 'impact', 'scope', 'technology', 'outcome'],
          },
        },
      },
    },
  },
};
