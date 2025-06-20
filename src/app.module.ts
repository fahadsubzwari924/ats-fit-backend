import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { validationSchema } from './config/validation.schema';
import { AuthModule } from './modules/auth/auth.module';
import { ResumeModule } from './modules/resume/resume.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? 'src/config/.env.prod'
          : 'src/config/.env.dev',
      validationSchema,
    }),
    DatabaseModule,
    AuthModule,
    ResumeModule,
  ],
})
export class AppModule {}
