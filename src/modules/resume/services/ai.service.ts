// ai.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from '../../../external/services/embedding.service';
import { OpenAIService } from '../../../external/services/open_ai.service';
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
} from '../../../external/interfaces/open-ai-chat.interface';
import { PromptService } from './prompt.service';
import {
  ResumeExtractedKeywordsSchema,
  TailoredContentSchema,
} from '../schemas/resume-tailored-content.schema';

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
    companyName: string,
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
      companyName,
      resumeText,
    );

    return {
      ...tailoredContent,
      metadata: {
        skillMatchScore: resumeAnalysis.skillMatchScore,
        missingKeywords: resumeAnalysis.missingKeywords,
      },
    };
  }

  private async extractKeywordsFromJD(
    jd: string,
  ): Promise<ResumeExtractedKeywords> {
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
      const parsed = JSON.parse(content);
      return ResumeExtractedKeywordsSchema.parse(parsed && typeof parsed === 'object' ? parsed : {}) as ResumeExtractedKeywords;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown parsing error';
      throw new Error(
        `Failed to parse OpenAI response for keyword extraction: ${errorMessage}`,
      );
    }
  }

  private async generateTailoredContent(
    analysis: ResumeAnalysis,
    jobDescription: string,
    companyName: string,
    originalResumeText: string,
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
      const parsedContent = JSON.parse(content);
      return TailoredContentSchema.parse(parsedContent && typeof parsedContent === 'object' ? parsedContent : {}) as TailoredContent;
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
}
