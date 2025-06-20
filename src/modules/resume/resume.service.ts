import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { User } from '../../database/entities/user.entity';
import { Resume } from '../../database/entities/resume.entity';
import { ResumeTemplate } from '../../database/entities/resume-templates.entity';
import { IResumeTemplate } from './interfaces/resume-template.interface';

@Injectable()
export class ResumeService {
  private readonly s3Client: S3Client;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Resume)
    private readonly resumeRepository: Repository<Resume>,
    @InjectRepository(ResumeTemplate)
    private readonly templateRepository: Repository<ResumeTemplate>,
    private readonly configService: ConfigService,
  ) {
    this.s3Client = new S3Client({
      region: this.configService.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get<string>(
          'AWS_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  async getResumeTemplates(): Promise<IResumeTemplate[]> {
    const resumeTemplates = await this.templateRepository.find();
    return resumeTemplates || [];
  }

  //   async generateResume(
  //     userId: string,
  //     dto: GenerateResumeDto,
  //   ): Promise<{ resume_id: string }> {
  //     const { original_resume, job_description, template_id } = dto;

  //     // Verify user
  //     const user = await this.userRepository.findOne({ where: { id: userId } });
  //     if (!user) {
  //       throw new NotFoundException('User not found');
  //     }

  //     // Verify template
  //     const template = await this.templateRepository.findOne({
  //       where: { id: template_id },
  //     });
  //     if (!template) {
  //       throw new NotFoundException('Template not found');
  //     }

  //     // Tailor resume content
  //     const tailored_content = await this.aiService.tailorResume(
  //       original_resume,
  //       job_description,
  //     );

  //     // Generate LaTeX content (simplified)
  //     const latexContent = await this.renderLatexTemplate(template.file_path, {
  //       name: user.email.split('@')[0],
  //       email: user.email,
  //       summary: 'Tailored professional summary',
  //       experience: tailored_content,
  //       education: 'Your education details',
  //       skills: 'Tailored skills',
  //     });

  //     // Generate PDF
  //     const pdfPath = await this.generatePdf(latexContent, userId, template.name);

  //     // Upload to S3
  //     const s3Key = `resumes/${userId}/${Date.now()}-${template.name}.pdf`;
  //     await this.uploadToS3(pdfPath, s3Key);

  //     // Save resume
  //     const resume = this.resumeRepository.create({
  //       file_path: s3Key,
  //       original_content: original_resume,
  //       tailored_content,
  //       created_at: new Date(),
  //       user,
  //       template,
  //     });
  //     await this.resumeRepository.save(resume);

  //     return { resume_id: resume.id };
  //   }

  //   async downloadResume(
  //     userId: string,
  //     resumeId: string,
  //   ): Promise<{ url: string }> {
  //     const resume = await this.resumeRepository.findOne({
  //       where: { id: resumeId, user: { id: userId } },
  //     });
  //     if (!resume) {
  //       throw new NotFoundException('Resume not found');
  //     }

  //     const url = await this.getS3SignedUrl(resume.file_path);
  //     return { url };
  //   }

  //   private async renderLatexTemplate(
  //     filePath: string,
  //     data: any,
  //   ): Promise<string> {
  //     // Load template and replace placeholders (simplified)
  //     const templatePath = join(process.cwd(), 'src', filePath);
  //     let content = require('fs').readFileSync(templatePath, 'utf8');
  //     Object.keys(data).forEach((key) => {
  //       content = content.replace(`Your ${key}`, data[key]);
  //     });
  //     return content;
  //   }

  //   private async generatePdf(
  //     latexContent: string,
  //     userId: string,
  //     templateName: string,
  //   ): Promise<string> {
  //     const outputPath = join(
  //       process.cwd(),
  //       `temp/${userId}-${templateName}-${Date.now()}.pdf`,
  //     );
  //     const input = createWriteStream('temp/input.tex');
  //     input.write(latexContent);
  //     input.end();

  //     const output = createWriteStream(outputPath);
  //     const pdf = latex(input);

  //     return new Promise((resolve, reject) => {
  //       pdf.pipe(output);
  //       pdf.on('error', reject);
  //       pdf.on('end', () => resolve(outputPath));
  //     });
  //   }

  //   private async uploadToS3(filePath: string, key: string): Promise<void> {
  //     const fileStream = createReadStream(filePath);
  //     const command = new PutObjectCommand({
  //       Bucket: this.configService.get<string>('AWS_S3_BUCKET'),
  //       Key: key,
  //       Body: fileStream,
  //       ContentType: 'application/pdf',
  //     });
  //     await this.s3Client.send(command);
  //   }

  //   private async getS3SignedUrl(key: string): Promise<string> {
  //     const command = new GetObjectCommand({
  //       Bucket: this.configService.get<string>('AWS_S3_BUCKET'),
  //       Key: key,
  //     });
  //     const url = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 }); // 1 hour
  //     return url;
  //   }
}
