import { ApiProperty } from '@nestjs/swagger';

export class GenerateResumeResponseDto {
  @ApiProperty({
    description: 'Generated resume generation record ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  resumeGenerationId: string;

  @ApiProperty({
    description: 'ATS score of the newly generated tailored resume',
    example: 87.5,
  })
  atsScore: number;

  @ApiProperty({
    description: 'PDF file as base64 encoded string',
    example: 'JVBERi0xLjQKJdPr6eEKMSAwIG9iago...',
  })
  pdfContent: string;

  @ApiProperty({
    description: 'Filename for the generated PDF',
    example: 'tailored-resume-1640995200000.pdf',
  })
  filename: string;

  @ApiProperty({
    description: 'Content type of the response',
    example: 'application/pdf',
  })
  contentType: string;
}
