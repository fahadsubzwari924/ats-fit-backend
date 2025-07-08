import { z } from 'zod';

export const AtsScoreResponseSchema = z.object({
  score: z.number().min(0).max(100),
  feedback: z.object({
    keywordMatch: z.number().min(0).max(100),
    formatting: z.number().min(0).max(100),
    contentRelevance: z.number().min(0).max(100),
    suggestions: z.array(z.string()).default([]),
  }),
});
