import { Controller, Get, UseGuards } from '@nestjs/common';
import { ResumeService } from './resume.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('resumes')
@UseGuards(JwtAuthGuard)
export class ResumeController {
  constructor(private readonly resumeService: ResumeService) {}

  @Get('templates')
  async getTemplates() {
    const templates = await this.resumeService.getResumeTemplates();
    return templates;
  }
}
