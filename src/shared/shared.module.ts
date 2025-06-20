import { Module } from '@nestjs/common';
import { BaseMapperService } from './services/base-mapper.service';

@Module({
  providers: [BaseMapperService],
  exports: [BaseMapperService],
})
export class SharedModule {}
