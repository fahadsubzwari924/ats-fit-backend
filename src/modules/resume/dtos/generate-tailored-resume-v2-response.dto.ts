import { ApiProperty } from '@nestjs/swagger';

export class GenerateTailoredResumeV2ResponseDto {
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
    description: 'ATS score of the generated resume (0-100)',
    example: 87,
    minimum: 0,
    maximum: 100,
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
  metadata: {
    aiModelsUsed: {
      jobAnalysis: string;
      contentGeneration: string;
      atsScoring: string;
    };
    optimizations: {
      keywordsAdded: number;
      sectionsOptimized: number;
      achievementsQuantified: number;
    };
  };
}
