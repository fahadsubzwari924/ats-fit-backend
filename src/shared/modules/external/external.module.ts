import { Module } from '@nestjs/common';
import { OpenAIService } from './services/open_ai.service';
import { S3Service } from './services/s3.service';
import { EmbeddingService } from './services/embedding.service';
import { ClaudeService } from './services/claude.service';
import { CircuitBreakerService } from '../../services/circuit-breaker.service';
import { BrevoService } from './services/brevo.service';

@Module({
  providers: [
    OpenAIService,
    S3Service,
    EmbeddingService,
    ClaudeService,
    CircuitBreakerService,
    BrevoService,
  ],
  exports: [
    OpenAIService,
    S3Service,
    EmbeddingService,
    ClaudeService,
    CircuitBreakerService,
    BrevoService,
  ],
})
export class ExternalModule {}
