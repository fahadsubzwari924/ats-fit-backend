import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Get,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { LocalResumeAnalysisService } from './services/local-resume-analysis.service';
import { LocalLlmService } from './services/local-llm.service';
import { FileValidationPipe } from '../resume/pipes/file-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Local LLM')
@Controller('local-llm')
export class LocalLlmController {
  private readonly logger = new Logger(LocalLlmController.name);

  constructor(
    private readonly localResumeAnalysisService: LocalResumeAnalysisService,
    private readonly localLlmService: LocalLlmService,
  ) {}

  @Post('analyze-resume')
  @Public()
  @UseInterceptors(FileInterceptor('resumeFile'))
  async analyzeResume(
    @UploadedFile(FileValidationPipe) resumeFile: Express.Multer.File,
  ) {
    try {
      this.logger.log('Starting resume analysis with local LLM');
      //   this.logger.debug(
      //     'Job description length:',
      //     analyzeResumeDto.jobDescription.length,
      //   );
      this.logger.debug('File info:', {
        filename: resumeFile?.originalname,
        mimetype: resumeFile?.mimetype,
        size: resumeFile?.size,
      });

      const result =
        await this.localResumeAnalysisService.analyzeResumeAndJobDescription(
          resumeFile,
        );

      this.logger.log(
        `Resume analysis completed in ${result.metadata.processingTime}ms`,
      );

      return result;
    } catch (error) {
      this.logger.error('Resume analysis failed:', error);
      throw error;
    }
  }

  @Get('health')
  @Public()
  async healthCheck() {
    const healthStatus = await this.localLlmService.healthCheck();

    return {
      ...healthStatus,
      timestamp: new Date().toISOString(),
      message: this.getHealthMessage(healthStatus.status),
    };
  }

  @Get('test-model')
  @Public()
  async testModel() {
    try {
      this.logger.log('Testing model response capabilities');
      const testResults = await this.localLlmService.testModel();

      return {
        status: 'success',
        timestamp: new Date().toISOString(),
        results: testResults,
      };
    } catch (error) {
      this.logger.error('Model test failed:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: errorMessage,
      };
    }
  }

  @Get('models')
  @Public()
  async getAvailableModels() {
    try {
      const models = await this.localLlmService.getAvailableModels();
      const currentModel = this.localLlmService.getModelName();

      return {
        status: 'success',
        timestamp: new Date().toISOString(),
        currentModel,
        availableModels: models,
      };
    } catch (error) {
      this.logger.error('Failed to get models:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: errorMessage,
      };
    }
  }

  private getHealthMessage(status: string): string {
    switch (status) {
      case 'healthy':
        return `Local LLM service is running and ${this.localLlmService.getModelName()} model is available`;
      case 'warning':
        return `Ollama is running but ${this.localLlmService.getModelName()} model may not be loaded`;
      case 'unhealthy':
        return 'Local LLM service is not available';
      default:
        return 'Unknown health status';
    }
  }
}
