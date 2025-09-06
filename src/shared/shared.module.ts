import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaseMapperService } from './services/base-mapper.service';
import { ResponseModule } from './modules/response/response.module';
import { PromptService } from './services/prompt.service';
import { AtsEvaluationService } from './services/ats-evaluation.service';
import { DatabaseModule } from '../database/database.module';
import { ExternalModule } from './modules/external/external.module';
import { AtsMatchHistory } from '../database/entities/ats-match-history.entity';

@Module({
  imports: [
    ResponseModule,
    DatabaseModule,
    ExternalModule,
    TypeOrmModule.forFeature([AtsMatchHistory]),
  ],
  providers: [BaseMapperService, PromptService, AtsEvaluationService],
  exports: [
    BaseMapperService,
    PromptService,
    AtsEvaluationService,
    ExternalModule,
  ],
})
export class SharedModule {}
