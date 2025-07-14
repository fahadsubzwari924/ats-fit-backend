import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ResumeTemplate } from '../../../database/entities/resume-templates.entity';
import { S3Service } from '../../../shared/modules/external/services/s3.service';
import { HandlebarsService } from '../../../shared/services/handlebars.service';
import { formatUnknownError } from '../../../shared/utils/error-formatter.util';
import {
  AnalysisResult,
  Education,
} from '../interfaces/resume-extracted-keywords.interface';
import { ConfigService } from '@nestjs/config';
import { getTemplateS3Key } from '../utils/s3.util';

@Injectable()
export class ResumeTemplateService {
  private readonly logger = new Logger(ResumeTemplateService.name);
  private templateContentCache = new Map<
    string,
    { content: string; timestamp: number }
  >();

  constructor(
    @InjectRepository(ResumeTemplate)
    private templateRepository: Repository<ResumeTemplate>,
    private s3Service: S3Service,
    private handlebarsService: HandlebarsService,
    private configService: ConfigService,
  ) {}

  async getResumeTemplates(): Promise<ResumeTemplate[]> {
    const resumeTemplates = await this.templateRepository.find({
      cache: true, // Enable caching for frequently accessed data
    });
    return resumeTemplates || [];
  }

  async getTemplateById(
    id: string,
  ): Promise<ResumeTemplate & { content: string }> {
    let template: ResumeTemplate;
    try {
      template = await this.templateRepository.findOne({
        where: { id },
        cache: true, // Cache frequently accessed templates
      });
      if (!template) {
        throw new NotFoundException(`Template with ID ${id} not found`);
      }
    } catch (error) {
      this.logger.error(`Database error finding template ${id}`, error);
      throw new InternalServerErrorException('Failed to retrieve template');
    }

    try {
      // Get cache TTL from configuration
      const cacheTtl = this.configService.get<number>(
        'performance.templateCacheTtl',
        600000,
      );

      // Check cache first
      const cached = this.templateContentCache.get(id);
      if (cached && Date.now() - cached.timestamp < cacheTtl) {
        return {
          ...template,
          content: cached.content,
        };
      }

      // Get bucket name from config - fixed the type annotation
      const bucketName = this.configService.get<string>(
        'AWS_S3_RESUME_TEMPLATES_BUCKET',
      );

      if (!bucketName) {
        throw new Error('AWS_S3_RESUME_TEMPLATES_BUCKET is not configured');
      }

      const templateContent = await this.s3Service.getObject({
        bucketName: bucketName,
        key: getTemplateS3Key(template.key),
      });

      const content = templateContent.toString('utf-8');

      // Cache the content
      this.templateContentCache.set(id, {
        content,
        timestamp: Date.now(),
      });

      return {
        ...template,
        content,
      };
    } catch (error) {
      this.logger.error(
        `Failed to load template content for ${id} from S3`,
        error,
      );
      if (error instanceof Error && error.message.includes('not found')) {
        throw new NotFoundException(
          `Template content not found for template ${id}`,
        );
      }

      throw new InternalServerErrorException('Failed to load template content');
    }
  }

  async applyTemplate(
    template: ResumeTemplate & { content: string },
    data: AnalysisResult,
  ): Promise<string> {
    try {
      this.logger.debug(
        `Applying template ${template.id} with data keys: ${Object.keys(data || {}).join(', ')}`,
      );

      // Register custom helpers - wrapped in Promise to make it awaitable
      await Promise.resolve(
        this.handlebarsService.registerHelper('json', (context: unknown) => {
          return JSON.stringify(context);
        }),
      );

      // Compile template
      const compiledTemplate = this.handlebarsService.compile(
        template.content,
        {
          noEscape: true,
          strict: true,
        },
      );

      // Create context with validated data
      const context = {
        ...data,
        currentDate: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      };

      // Execute template
      const result = compiledTemplate(context);

      // Log template usage asynchronously without blocking
      this.logTemplateUsage(template.id).catch((error) => {
        this.logger.error('Failed to log template usage', error);
      });

      return result;
    } catch (error: unknown) {
      const formatted = formatUnknownError(error);
      this.logger.error(
        `Failed to apply template ${template.id}\n${formatted}`,
      );

      // Log the data structure that caused the error for debugging
      if (data) {
        this.logger.error(
          `Data structure that caused error: ${JSON.stringify({
            hasTitle: !!data.title,
            hasContactInfo: !!data.contactInfo,
            hasSummary: !!data.summary,
            hasSkills: !!data.skills,
            experienceLength: Array.isArray(data.experience)
              ? data.experience.length
              : 'not array',
            educationLength: Array.isArray(data.education)
              ? data.education.length
              : 'not array',
            hasCertifications: !!data.certifications,
            hasAdditionalSections: !!data.additionalSections,
          })}`,
        );
      }

      if (error instanceof Error) {
        if (error.message.includes('not defined')) {
          throw new Error(
            `Template error: Missing required variable - ${error.message}`,
          );
        }
        throw new Error(
          `Failed to generate resume from template: ${error.message}`,
        );
      }

      throw new Error(`Failed to generate resume from template: ${formatted}`);
    }
  }

  private validateAndSetDefaults(data: AnalysisResult): AnalysisResult {
    // Ensure all required fields have default values to prevent undefined errors
    const validatedData: AnalysisResult = {
      title: data.title || '',
      contactInfo: {
        name: data.contactInfo?.name || '',
        email: data.contactInfo?.email || '',
        phone: data.contactInfo?.phone || '',
        location: data.contactInfo?.location || '',
        linkedin: data.contactInfo?.linkedin || '',
        portfolio: data.contactInfo?.portfolio || '',
        github: data.contactInfo?.github || '',
      },
      summary: data.summary || '',
      skills: {
        languages: Array.isArray(data.skills?.languages)
          ? data.skills.languages
          : [],
        frameworks: Array.isArray(data.skills?.frameworks)
          ? data.skills.frameworks
          : [],
        tools: Array.isArray(data.skills?.tools) ? data.skills.tools : [],
        databases: Array.isArray(data.skills?.databases)
          ? data.skills.databases
          : [],
        concepts: Array.isArray(data.skills?.concepts)
          ? data.skills.concepts
          : [],
      },
      experience: Array.isArray(data.experience)
        ? data.experience.map((exp) => ({
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
      education: this.validateEducation(data.education),
      certifications: Array.isArray(data.certifications)
        ? data.certifications.map((cert) => ({
            name: cert.name || '',
            issuer: cert.issuer || '',
            date: cert.date || '',
            expiryDate: cert.expiryDate || '',
            credentialId: cert.credentialId || '',
          }))
        : [],
      additionalSections: Array.isArray(data.additionalSections)
        ? data.additionalSections.map((section) => ({
            title: section.title || '',
            items: Array.isArray(section.items) ? section.items : [],
          }))
        : [],
      metadata: data.metadata || {
        skillMatchScore: 0,
        missingKeywords: [],
      },
    };

    return validatedData;
  }

  private validateEducation(education: unknown): Education[] {
    if (!education) {
      return [];
    }

    // If education is a single object, convert it to an array
    if (!Array.isArray(education)) {
      education = [education] as Education[];
    }

    // Validate each education entry and provide defaults
    return (education as Education[]).map((edu: Education) => {
      return {
        institution: edu.institution || '',
        degree: edu.degree || '',
        major: edu.major || '',
        startDate: edu.startDate || '',
        endDate: edu.endDate || '',
      };
    });
  }

  // Example async logging method to satisfy await requirement
  private async logTemplateUsage(templateId: string): Promise<void> {
    try {
      // In a real app, you might log to a database
      await Promise.resolve();
      this.logger.debug(
        `Template ${templateId} used at ${new Date().toISOString()}`,
      );
    } catch (loggingError) {
      this.logger.error('Failed to log template usage', loggingError);
    }
  }
}
