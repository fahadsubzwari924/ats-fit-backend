import { ApiProperty } from '@nestjs/swagger';
import { GenerationMetadata } from '../interfaces/generation-metadata.interface';

export class GenerateTailoredResumeResponseDto {
  @ApiProperty({
    description: 'Base64 encoded PDF content of the generated resume',
    example: 'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwo...',
  })
  pdfContent: string;

  @ApiProperty({
    description: 'ID of the resume generation record',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  resumeGenerationId: string;

  @ApiProperty({
    description:
      'ATS score of the generated resume (0-100). Deprecated — use matchScore instead.',
    example: 87,
    minimum: 0,
    maximum: 100,
    deprecated: true,
  })
  atsScore: number;

  @ApiProperty({
    description: 'Processing time in milliseconds',
    example: 5420,
  })
  processingTimeMs: number;

  @ApiProperty({
    description: 'Generated resume filename',
    example: 'tailored_resume_google_senior_fullstack_20250118.pdf',
  })
  filename: string;

  @ApiProperty({
    description: 'Size of the generated PDF in bytes',
    example: 245760,
  })
  fileSizeBytes: number;

  @ApiProperty({
    description: 'Template used for generation',
    example: 'modern',
  })
  templateName: string;

  @ApiProperty({
    description: 'Metadata about the resume generation process',
    type: 'object',
    properties: {
      aiModelsUsed: {
        type: 'object',
        properties: {
          jobAnalysis: { type: 'string', example: 'gpt-4-turbo' },
          contentGeneration: { type: 'string', example: 'claude-3-5-sonnet' },
          atsScoring: { type: 'string', example: 'claude-3-5-sonnet' },
        },
      },
      optimizations: {
        type: 'object',
        properties: {
          keywordsAdded: { type: 'number', example: 12 },
          sectionsOptimized: { type: 'number', example: 5 },
          achievementsQuantified: { type: 'number', example: 8 },
        },
      },
    },
  })
  metadata: GenerationMetadata;

  @ApiProperty({
    description:
      'Keyword match score before and after tailoring, with the improvement delta',
    type: 'object',
    properties: {
      before: { type: 'number', example: 42 },
      after: { type: 'number', example: 78 },
      delta: { type: 'number', example: 36 },
    },
  })
  matchScore: { before: number; after: number; delta: number };

  @ApiProperty({
    description: 'Number of ATS format checks passed out of total checks',
    type: 'object',
    properties: {
      passed: { type: 'number', example: 8 },
      total: { type: 'number', example: 10 },
    },
  })
  atsChecks: { passed: number; total: number };

  @ApiProperty({
    description:
      'Number of resume bullets containing quantified achievements before and after tailoring',
    type: 'object',
    properties: {
      before: { type: 'number', example: 3 },
      after: { type: 'number', example: 7 },
      total: { type: 'number', example: 7 },
    },
  })
  bulletsQuantified: { before: number; after: number; total: number };
}
