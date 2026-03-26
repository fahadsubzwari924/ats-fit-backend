import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TailoringQuestion } from '../../../database/entities/tailoring-session.entity';
import { Experience } from '../interfaces/resume-extracted-keywords.interface';

/**
 * Response DTO for a single profile question.
 *
 * Encapsulates all mapping logic so controllers stay free of data transformation.
 * Pass the entity and the matching Experience (looked up by workExperienceIndex)
 * and this class produces the correctly-shaped response.
 */
export class ProfileQuestionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  workExperienceIndex: number;

  @ApiProperty()
  bulletPointIndex: number;

  @ApiProperty()
  originalBulletPoint: string;

  @ApiProperty()
  questionText: string;

  @ApiProperty()
  questionCategory: string;

  @ApiPropertyOptional({ nullable: true })
  userResponse: string | null;

  @ApiProperty()
  isAnswered: boolean;

  @ApiProperty()
  orderIndex: number;

  @ApiPropertyOptional({ nullable: true })
  companyName: string | null;

  @ApiPropertyOptional({ nullable: true })
  jobTitle: string | null;

  constructor(question: TailoringQuestion, experience: Experience | null) {
    this.id = question.id;
    this.workExperienceIndex = question.workExperienceIndex;
    this.bulletPointIndex = question.bulletPointIndex;
    this.originalBulletPoint = question.originalBulletPoint;
    this.questionText = question.questionText;
    this.questionCategory = question.questionCategory;
    this.userResponse = question.userResponse ?? null;
    this.isAnswered = question.isAnswered;
    this.orderIndex = question.orderIndex;
    this.companyName = experience?.company ?? null;
    this.jobTitle = experience?.position ?? null;
  }
}
