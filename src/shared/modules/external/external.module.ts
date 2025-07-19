import { Module } from '@nestjs/common';
import { OpenAIService } from './services/open_ai.service';
import { S3Service } from './services/s3.service';
import { EmbeddingService } from './services/embedding.service';
import { ClaudeService } from './services/claude.service';

@Module({
  providers: [OpenAIService, S3Service, EmbeddingService, ClaudeService],
  exports: [OpenAIService, S3Service, EmbeddingService, ClaudeService],
})
export class ExternalModule {}
