// ai.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from '../modules/external/services/embedding.service';
import { OpenAIService } from '../modules/external/services/open_ai.service';
import {
  ResumeAnalysis,
  ResumeExtractedKeywords,
  TailoredContent,
} from '../../modules/resume-tailoring/interfaces/resume-extracted-keywords.interface';
import { get, head, isEmpty } from 'lodash';
import {
  ChatCompletionChoice,
  ChatCompletionResponse,
} from '../modules/external/interfaces/open-ai-chat.interface';
import { PromptService } from './prompt.service';
import {
  ResumeExtractedKeywordsSchema,
  TailoredContentSchema,
} from '../../modules/resume-tailoring/schemas/resume-tailored-content.schema';
import { InternalServerErrorException } from '../exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../constants/error-codes';

@Injectable()
export class AIContentService {
  constructor(
    private openAIService: OpenAIService,
    private embeddingService: EmbeddingService,
    private promptService: PromptService,
    private configService: ConfigService,
  ) {}

  async extractKeywordsFromJD(jd: string): Promise<ResumeExtractedKeywords> {
    const prompt =
      this.promptService.getExtractKeywordsFromJobDescriptionPrompt(jd);

    const result = (await this.openAIService.chatCompletion({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    })) as ChatCompletionResponse;

    const choices = get(result, 'choices', []) as ChatCompletionChoice[];
    if (isEmpty(choices)) {
      throw new Error('No response choices received from OpenAI');
    }

    const content = get(head(choices), 'message.content');
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    try {
      const parsed = JSON.parse(content) as ResumeExtractedKeywords;
      return ResumeExtractedKeywordsSchema.parse(
        parsed && typeof parsed === 'object' ? parsed : {},
      ) as ResumeExtractedKeywords;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown parsing error';
      throw new Error(
        `Failed to parse OpenAI response for keyword extraction: ${errorMessage}`,
      );
    }
  }

  async extractKeywordsFromJDForAts(
    jd: string,
  ): Promise<ResumeExtractedKeywords> {
    const prompt =
      this.promptService.getExtractKeywordsFromJobDescriptionForAtsPrompt(jd);

    const result = (await this.openAIService.chatCompletion({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    })) as ChatCompletionResponse;

    const choices = get(result, 'choices', []) as ChatCompletionChoice[];
    if (isEmpty(choices)) {
      throw new Error('No response choices received from OpenAI');
    }

    const content = get(head(choices), 'message.content');
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    try {
      const parsed = JSON.parse(content) as ResumeExtractedKeywords;
      return ResumeExtractedKeywordsSchema.parse(
        parsed && typeof parsed === 'object' ? parsed : {},
      ) as ResumeExtractedKeywords;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown parsing error';
      throw new Error(
        `Failed to parse OpenAI response for ATS keyword extraction: ${errorMessage}`,
      );
    }
  }

  private async generateTailoredContent(
    analysis: ResumeAnalysis,
    jobDescription: string,
    originalResumeText: string,
    companyName?: string,
  ): Promise<TailoredContent> {
    const prompt = this.promptService.getTailoredResumePrompt(
      originalResumeText,
      jobDescription,
      companyName,
      analysis,
    );

    const result = (await this.openAIService.chatCompletion({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    })) as ChatCompletionResponse;

    const choices = get(result, 'choices', []) as ChatCompletionChoice[];
    if (isEmpty(choices)) {
      throw new Error(
        'No response choices received from OpenAI for content generation',
      );
    }

    const content = get(head(choices), 'message.content');
    if (!content) {
      throw new Error('No content in OpenAI response for content generation');
    }

    try {
      const parsedContent = JSON.parse(content) as TailoredContent;
      return TailoredContentSchema.parse(
        parsedContent && typeof parsedContent === 'object' ? parsedContent : {},
      ) as TailoredContent;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown parsing error';
      throw new Error(
        `Failed to parse OpenAI response for content generation: ${errorMessage}`,
      );
    }
  }

  private validateTailoredContent(content: TailoredContent): TailoredContent {
    // Ensure all required fields have default values
    return {
      title: content.title || '',
      contactInfo: {
        name: content.contactInfo?.name || '',
        email: content.contactInfo?.email || '',
        phone: content.contactInfo?.phone || '',
        location: content.contactInfo?.location || '',
        linkedin: content.contactInfo?.linkedin || '',
        portfolio: content.contactInfo?.portfolio || '',
        github: content.contactInfo?.github || '',
      },
      summary: content.summary || '',
      skills: {
        languages: Array.isArray(content.skills?.languages)
          ? content.skills.languages
          : [],
        frameworks: Array.isArray(content.skills?.frameworks)
          ? content.skills.frameworks
          : [],
        tools: Array.isArray(content.skills?.tools) ? content.skills.tools : [],
        databases: Array.isArray(content.skills?.databases)
          ? content.skills.databases
          : [],
        concepts: Array.isArray(content.skills?.concepts)
          ? content.skills.concepts
          : [],
      },
      experience: Array.isArray(content.experience)
        ? content.experience.map((exp) => ({
            company: exp.company || '',
            position: exp.position || '',
            duration: exp.duration || '',
            location: exp.location || '',
            responsibilities: Array.isArray(exp.responsibilities)
              ? exp.responsibilities
              : [],
            achievements: Array.isArray(exp.achievements)
              ? exp.achievements
              : [],
            startDate: exp.startDate || '',
            endDate: exp.endDate || '',
            technologies: exp.technologies || '',
          }))
        : [],
      education: Array.isArray(content.education)
        ? content.education.map((edu) => ({
            institution: edu.institution || '',
            degree: edu.degree || '',
            major: edu.major || '',
            startDate: edu.startDate || '',
            endDate: edu.endDate || '',
          }))
        : [],
      certifications: Array.isArray(content.certifications)
        ? content.certifications.map((cert) => ({
            name: cert.name || '',
            issuer: cert.issuer || '',
            date: cert.date || '',
            expiryDate: cert.expiryDate || '',
            credentialId: cert.credentialId || '',
          }))
        : [],
      additionalSections: Array.isArray(content.additionalSections)
        ? content.additionalSections.map((section) => ({
            title: section.title || '',
            items: Array.isArray(section.items) ? section.items : [],
          }))
        : [],
    };
  }

  async evaluateResumeWithAtsCriteria(
    resumeText: string,
    jobDescription: string,
  ): Promise<any> {
    const prompt = this.promptService.getAtsEvaluationPrompt(
      resumeText,
      jobDescription,
    );
    const result = await this.openAIService.chatCompletion({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in ATS evaluation response');
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to parse ATS evaluation JSON',
        ERROR_CODES.FAILED_TO_PARSE_ATS_EVALUATION_JSON,
        null,
        error,
      );
    }
  }

  /**
   * Extract structured content from resume text without job-specific analysis
   * This method focuses solely on parsing raw resume text into structured format
   * Following Single Responsibility Principle - only handles content parsing
   *
   * @param resumeText - Raw text extracted from resume
   * @returns Promise<TailoredContent> - Structured resume content
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

      // Validate the structure using existing schema
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
