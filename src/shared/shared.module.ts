import { Module } from '@nestjs/common';
import { BaseMapperService } from './services/base-mapper.service';
import { ResponseModule } from './modules/response/response.module';

@Module({
  imports: [ResponseModule],
  providers: [BaseMapperService],
  exports: [BaseMapperService],
})
export class SharedModule {}
