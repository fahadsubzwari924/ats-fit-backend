import { Module } from '@nestjs/common';
import { BaseMapperService } from './services/base-mapper.service';
import { ResponseModule } from './modules/response/response.module';
import { PromptService } from './services/prompt.service';

@Module({
  imports: [ResponseModule],
  providers: [BaseMapperService, PromptService],
  exports: [BaseMapperService, PromptService],
})
export class SharedModule {}
