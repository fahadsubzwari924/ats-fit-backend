import { Module } from '@nestjs/common';
import { LocalLlmController } from './local-llm.controller';
import { LocalLlmService } from './services/local-llm.service';
import { LocalResumeAnalysisService } from './services/local-resume-analysis.service';

@Module({
  controllers: [LocalLlmController],
  providers: [LocalLlmService, LocalResumeAnalysisService],
  exports: [LocalLlmService, LocalResumeAnalysisService],
})
export class LocalLlmModule {}
