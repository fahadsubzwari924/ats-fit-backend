// ai.schemas.ts
import { z } from 'zod';

// Schema for ResumeExtractedKeywords
const ResumeExtractedKeywordsSchema = z.object({
  hardSkills: z.array(z.string()).default([]),
  softSkills: z.array(z.string()).default([]),
  qualifications: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
}).strict();

// Schema for TailoredContent
const TailoredContentSchema = z.object({
  title: z.string().default(''),
  contactInfo: z
    .object({
      name: z.string().default(''),
      email: z.string().default(''),
      phone: z.string().default(''),
      location: z.string().default(''),
      linkedin: z.string().default(''),
      portfolio: z.string().default(''),
      github: z.string().default(''),
    })
    .strict()
    .default({
      name: '',
      email: '',
      phone: '',
      location: '',
      linkedin: '',
      portfolio: '',
      github: '',
    }),
  summary: z.string().default(''),
  skills: z
    .object({
      languages: z.array(z.string()).default([]),
      frameworks: z.array(z.string()).default([]),
      tools: z.array(z.string()).default([]),
      databases: z.array(z.string()).default([]),
      concepts: z.array(z.string()).default([]),
    })
    .strict()
    .default({
      languages: [],
      frameworks: [],
      tools: [],
      databases: [],
      concepts: [],
    }),
  experience: z
    .array(
      z.object({
        company: z.string().default(''),
        position: z.string().default(''),
        duration: z.string().default(''),
        location: z.string().default(''),
        responsibilities: z.array(z.string()).default([]),
        achievements: z.array(z.string()).default([]),
        startDate: z.string().default(''),
        endDate: z.string().default(''),
        technologies: z.string().default(''),
      }).strict(),
    )
    .default([]),
  education: z
    .array(
      z.object({
        institution: z.string().default(''),
        degree: z.string().default(''),
        major: z.string().default(''),
        startDate: z.string().default(''),
        endDate: z.string().default(''),
      }).strict(),
    )
    .default([]),
  certifications: z
    .array(
      z.object({
        name: z.string().default(''),
        issuer: z.string().default(''),
        date: z.string().default(''),
        expiryDate: z.string().default(''),
        credentialId: z.string().default(''),
      }).strict(),
    )
    .default([]),
  additionalSections: z
    .array(
      z.object({
        title: z.string().default(''),
        items: z.array(z.string()).default([]),
      }).strict(),
    )
    .default([]),
}).strict();

// Schema for AnalysisResult
const AnalysisResultSchema = z.object({
  title: z.string().default(''),
  contactInfo: TailoredContentSchema.shape.contactInfo,
  summary: z.string().default(''),
  skills: TailoredContentSchema.shape.skills,
  experience: TailoredContentSchema.shape.experience,
  education: TailoredContentSchema.shape.education,
  certifications: TailoredContentSchema.shape.certifications,
  additionalSections: TailoredContentSchema.shape.additionalSections,
  metadata: z
    .object({
      skillMatchScore: z.number().min(0).max(1).default(0),
      missingKeywords: z.array(z.string()).default([]),
    })
    .default({ skillMatchScore: 0, missingKeywords: [] }),
});

export {
  ResumeExtractedKeywordsSchema,
  TailoredContentSchema,
  AnalysisResultSchema,
};
