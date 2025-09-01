import { ApiProperty } from '@nestjs/swagger';

export class AtsScoreResponseDto {
  @ApiProperty({
    description: 'ATS compatibility score (0-100)',
    example: 85,
    minimum: 0,
    maximum: 100,
  })
  score: number;

  @ApiProperty({
    description: 'ID of the newly created ATS match history record',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  atsMatchHistoryId: string; // ID of the newly created ATS match history record

  @ApiProperty({
    description: 'Detailed analysis of the ATS score calculation',
  })
  details: {
    keywordScore: number;
    contactInfoScore: number;
    structureScore: number;
    matched: {
      hardSkills: string[];
      softSkills: string[];
      qualifications: string[];
    };
    extracted: any;
    sectionScores: Record<string, number>;
    skillMatchScore: number;
    missingKeywords: string[];
    tailoredContent: any; // LLM feedback and tailored content
    atsEvaluation: any; // advanced LLM-based ATS feedback
  };

  @ApiProperty({
    description: 'Additional analysis data (optional)',
    required: false,
  })
  analysis?: any;
}
