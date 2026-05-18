import { z } from 'zod';

// Strict mirror of RETURN_OPTIMIZED_RESUME_TOOL.input_schema in
// ../types/claude-tools.ts. Unlike TailoredContentSchema, missing fields fail
// rather than silently defaulting — this schema is the runtime gate that
// catches "AI omitted/malformed a required field" before downstream callers
// dereference it.
const ContactInfoSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  linkedin: z.string(),
  portfolio: z.string(),
  github: z.string(),
});

const SkillsSchema = z.object({
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  tools: z.array(z.string()),
  databases: z.array(z.string()),
  concepts: z.array(z.string()),
});

const ExperienceSchema = z.object({
  company: z.string(),
  position: z.string(),
  duration: z.string(),
  location: z.string(),
  responsibilities: z.array(z.string()),
  achievements: z.array(z.string()),
  startDate: z.string(),
  endDate: z.string(),
  technologies: z.string(),
});

const EducationSchema = z.object({
  institution: z.string(),
  degree: z.string(),
  major: z.string(),
  startDate: z.string(),
  endDate: z.string(),
});

const CertificationSchema = z.object({
  name: z.string(),
  issuer: z.string(),
  date: z.string(),
  expiryDate: z.string(),
  credentialId: z.string(),
});

const AdditionalSectionSchema = z.object({
  title: z.string(),
  items: z.array(z.string()),
});

const OptimizedContentSchema = z.object({
  title: z.string(),
  contactInfo: ContactInfoSchema,
  summary: z.string(),
  skills: SkillsSchema,
  experience: z.array(ExperienceSchema),
  education: z.array(EducationSchema),
  certifications: z.array(CertificationSchema),
  additionalSections: z.array(AdditionalSectionSchema),
});

const OptimizationMetricsSchema = z.object({
  keywordsAdded: z.number(),
  sectionsOptimized: z.number(),
  achievementsQuantified: z.number(),
  skillsAligned: z.number(),
  confidenceScore: z.number().min(0).max(100),
});

const OptimizationStrategySchema = z.object({
  primaryFocus: z.array(z.string()),
  improvementAreas: z.array(z.string()),
  atsOptimizations: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export const ResumeOptimizationResultSchema = z.object({
  optimizedContent: OptimizedContentSchema,
  optimizationMetrics: OptimizationMetricsSchema,
  optimizationStrategy: OptimizationStrategySchema.optional(),
});

export type ResumeOptimizationResultParsed = z.infer<
  typeof ResumeOptimizationResultSchema
>;
