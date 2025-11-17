import { Module, Global } from '@nestjs/common';
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
import { AIContentService } from './services/ai-content.service';
import { FileValidationPipe } from './pipes/file-validation.pipe';
import { LemonSqueezyService } from '../modules/subscription/externals/services/lemon_squeezy.service';
import { LemonSqueezyPaymentGateway } from '../modules/subscription/externals/gateways/lemonsqueezy-payment.gateway';
import { EMAIL_SERVICE_TOKEN } from './interfaces/email.interface';
import { AwsSesService } from './services/aws-ses.service';
import { S3TemplateProviderService } from './services/s3-template-provider.service';
import { HandlebarsTemplateRendererService } from './services/handlebars-template-renderer.service';
import { TEMPLATE_PROVIDER_TOKEN } from './interfaces/template-provider.interface';
import { TEMPLATE_RENDERER_TOKEN } from './interfaces/template-renderer.interface';

@Global()
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
    AIContentService,
    FileValidationPipe,
    
    // Email services with dependency injection
    S3TemplateProviderService,
    HandlebarsTemplateRendererService,
    AwsSesService,
    
    // Template provider abstraction
    {
      provide: TEMPLATE_PROVIDER_TOKEN,
      useClass: S3TemplateProviderService,
    },
    
    // Template renderer abstraction
    {
      provide: TEMPLATE_RENDERER_TOKEN,
      useClass: HandlebarsTemplateRendererService,
    },
    
    // Email service abstraction
    {
      provide: EMAIL_SERVICE_TOKEN,
      useClass: AwsSesService,
    },
    
    // Payment Gateways
    LemonSqueezyService,
    LemonSqueezyPaymentGateway,
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
    AIContentService,
    FileValidationPipe,
    
    // Export email service token for dependency injection
    EMAIL_SERVICE_TOKEN,
    
    // Export template abstractions for custom implementations
    TEMPLATE_PROVIDER_TOKEN,
    TEMPLATE_RENDERER_TOKEN,
  ],
})
export class SharedModule {}
