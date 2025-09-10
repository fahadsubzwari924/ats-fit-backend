// ai.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from '../../../shared/modules/external/services/embedding.service';
import { OpenAIService } from '../../../shared/modules/external/services/open_ai.service';
import {
  AnalysisResult,
  ResumeAnalysis,
  ResumeExtractedKeywords,
  TailoredContent,
} from '../interfaces/resume-extracted-keywords.interface';
import { get, head, isEmpty } from 'lodash';
import {
  ChatCompletionChoice,
  ChatCompletionResponse,
} from '../../../shared/modules/external/interfaces/open-ai-chat.interface';
import { PromptService } from '../../../shared/services/prompt.service';
import {
  ResumeExtractedKeywordsSchema,
  TailoredContentSchema,
} from '../schemas/resume-tailored-content.schema';
import { InternalServerErrorException } from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

@Injectable()
export class AIService {
  constructor(
    private openAIService: OpenAIService,
    private embeddingService: EmbeddingService,
    private promptService: PromptService,
    private configService: ConfigService,
  ) {}

  async analyzeResumeAndJobDescription(
    resumeText: string,
    jobDescription: string,
    companyName?: string,
  ): Promise<AnalysisResult> {
    // Get performance configuration
    const maxSkillsForEmbedding = this.configService.get<number>(
      'performance.maxSkillsForEmbedding',
      10,
    );
    const maxMissingSkills = this.configService.get<number>(
      'performance.maxMissingSkills',
      5,
    );

    // Parallel execution of independent operations
    const [extractedData, resumeEmbedding] = await Promise.all([
      this.extractKeywordsFromJD(jobDescription),
      this.embeddingService.getEmbedding(resumeText),
    ]);

    const requiredSkills = [
      ...extractedData.hardSkills,
      ...extractedData.softSkills,
      ...extractedData.qualifications,
    ];

    // Limit skills to configured maximum to reduce embedding calls
    const limitedSkills = requiredSkills.slice(0, maxSkillsForEmbedding);

    // Get embeddings for skills in parallel
    const skillEmbeddings = await Promise.all(
      limitedSkills.map((skill: string) =>
        this.embeddingService.getEmbedding(skill),
      ),
    );

    // Calculate similarity scores
    const similarityScores = skillEmbeddings.map((embedding: number[]) =>
      this.embeddingService.cosineSimilarity(resumeEmbedding, embedding),
    );

    // Calculate match score (average of top 5 scores)
    const sortedScores = [...similarityScores].sort(
      (a: number, b: number) => b - a,
    );
    const topScores = sortedScores.slice(0, Math.min(5, sortedScores.length));
    const averageScore =
      topScores.reduce((a: number, b: number) => a + b, 0) / topScores.length;

    // Identify missing skills (scores below threshold)
    const missingSkills = limitedSkills.filter(
      (_: string, index: number) => similarityScores[index] < 0.5,
    );

    // Prioritize missing skills by similarity score
    const prioritizedMissing = missingSkills
      .map((skill) => ({
        skill,
        score: similarityScores[limitedSkills.indexOf(skill)],
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.skill)
      .slice(0, maxMissingSkills);

    const resumeAnalysis: ResumeAnalysis = {
      skillMatchScore: averageScore,
      missingKeywords: prioritizedMissing,
      resumeEmbedding,
    };

    // Generate tailored content
    const tailoredContent = await this.generateTailoredContent(
      resumeAnalysis,
      jobDescription,
      resumeText,
      companyName,
    );

    return {
      ...tailoredContent,
      metadata: {
        skillMatchScore: resumeAnalysis.skillMatchScore,
        missingKeywords: resumeAnalysis.missingKeywords,
      },
    };
  }

  async analyzeResumeForAtsScore(
    resumeText: string,
    jobDescription: string,
  ): Promise<{ skillMatchScore: number; missingKeywords: string[] }> {
    // Get performance configuration for ATS scoring
    const maxSkillsForEmbedding = this.configService.get<number>(
      'performance.maxSkillsForEmbedding',
      15, // Increased for ATS scoring
    );
    const maxMissingSkills = this.configService.get<number>(
      'performance.maxMissingSkills',
      5,
    );

    // Parallel execution of independent operations
    const [extractedData, resumeEmbedding] = await Promise.all([
      this.extractKeywordsFromJDForAts(jobDescription),
      this.embeddingService.getEmbedding(resumeText),
    ]);

    const requiredSkills = [
      ...extractedData.hardSkills,
      ...extractedData.softSkills,
      ...extractedData.qualifications,
    ];

    // Limit skills to configured maximum to reduce embedding calls
    const limitedSkills = requiredSkills.slice(0, maxSkillsForEmbedding);

    // Get embeddings for skills in parallel
    const skillEmbeddings = await Promise.all(
      limitedSkills.map((skill: string) =>
        this.embeddingService.getEmbedding(skill),
      ),
    );

    // Calculate similarity scores
    const similarityScores = skillEmbeddings.map((embedding: number[]) =>
      this.embeddingService.cosineSimilarity(resumeEmbedding, embedding),
    );

    // Calculate weighted match score (improved algorithm for ATS)
    const skillScores = limitedSkills.map((skill, index) => ({
      skill,
      score: similarityScores[index],
    }));

    // Sort by score and apply weighted scoring
    const sortedSkillScores = skillScores.sort((a, b) => b.score - a.score);

    // Weight top skills more heavily (top 3 get higher weight)
    const weightedScores = sortedSkillScores.map((item, index) => {
      let weight = 1;
      if (index < 3)
        weight = 1.5; // Top 3 skills get 50% more weight
      else if (index < 7) weight = 1.2; // Next 4 skills get 20% more weight
      return item.score * weight;
    });

    // Calculate weighted average
    const totalWeight = weightedScores.reduce((sum, _, index) => {
      if (index < 3) return sum + 1.5;
      else if (index < 7) return sum + 1.2;
      return sum + 1;
    }, 0);

    const averageScore =
      weightedScores.reduce((sum, score) => sum + score, 0) / totalWeight;

    // Identify missing skills with improved threshold for ATS
    const missingSkills = limitedSkills.filter(
      (_: string, index: number) => similarityScores[index] < 0.4, // Lowered threshold for ATS
    );

    // Prioritize missing skills by similarity score
    const prioritizedMissing = missingSkills
      .map((skill) => ({
        skill,
        score: similarityScores[limitedSkills.indexOf(skill)],
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.skill)
      .slice(0, maxMissingSkills);

    return {
      skillMatchScore: averageScore,
      missingKeywords: prioritizedMissing,
    };
  }

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
