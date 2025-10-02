import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaseMapperService } from './services/base-mapper.service';
import { ResponseModule } from './modules/response/response.module';
import { PromptService } from './services/prompt.service';
import { AtsEvaluationService } from './services/ats-evaluation.service';
import { DatabaseModule } from '../database/database.module';
import { ExternalModule } from './modules/external/external.module';
import { AtsMatchHistory } from '../database/entities/ats-match-history.entity';
import { UserContextTransformationService } from './services/user-context-transformation.service';
import { GenericUserContextTransformer } from './transformers/generic-user-context.transformer';
import { CacheService } from './services/cache.service';
import { ValidationModule } from './modules/validation/validation.module';

@Module({
  imports: [
    ResponseModule,
    DatabaseModule,
    ExternalModule,
    ValidationModule,
    TypeOrmModule.forFeature([AtsMatchHistory]),
  ],
  providers: [
    BaseMapperService,
    PromptService,
    AtsEvaluationService,
    UserContextTransformationService,
    GenericUserContextTransformer,
    CacheService,
  ],
  exports: [
    BaseMapperService,
    PromptService,
    AtsEvaluationService,
    ExternalModule,
    ValidationModule,
    UserContextTransformationService,
    GenericUserContextTransformer,
    CacheService,
  ],
})
export class SharedModule {}
