import { Injectable } from '@nestjs/common';
import { OpenAIService } from '../modules/external/services/open_ai.service';
import { TailoredContent } from '../../modules/resume-tailoring/interfaces/resume-extracted-keywords.interface';
import { PromptService } from './prompt.service';
import { TailoredContentSchema } from '../../modules/resume-tailoring/schemas/resume-tailored-content.schema';
import { InternalServerErrorException } from '../exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../constants/error-codes';

@Injectable()
export class AIContentService {
  constructor(
    private readonly openAIService: OpenAIService,
    private readonly promptService: PromptService,
  ) {}

  /**
   * Extract structured content from resume text without job-specific analysis.
   */
  async extractResumeContent(resumeText: string): Promise<TailoredContent> {
    const prompt =
      this.promptService.getResumeContentExtractionPrompt(resumeText);

    const result = await this.openAIService.chatCompletion({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No content in resume extraction response');
    }

    try {
      const parsedContent: unknown = JSON.parse(content);
      const validatedContent = TailoredContentSchema.parse(parsedContent);
      return validatedContent as TailoredContent;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to parse resume content JSON',
        ERROR_CODES.FAILED_TO_PARSE_ATS_EVALUATION_JSON,
        null,
        error,
      );
    }
  }
}
