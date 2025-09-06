import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  ValidationPipe,
  VersioningType,
  BadRequestException,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ResponseService } from './shared/modules/response/response.service';
import { ResponseInterceptor } from './shared/modules/response/response.interceptor';
import { AllExceptionsFilter } from './shared/modules/response/exception.filter';
import { RequestIdMiddleware } from './shared/modules/response/request-id.middleware';
import { Request, Response, NextFunction } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for all origins (adjust for production)
  app.enableCors({
    origin: true, // Allow all origins for development
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Resume-Generation-Id',
      'X-ATS-Score',
      'X-Filename',
    ],
    exposedHeaders: [
      'X-Resume-Generation-Id',
      'X-ATS-Score',
      'X-Filename',
      'Content-Disposition',
    ],
    credentials: true,
  });

  app.setGlobalPrefix('api');

  // --- Swagger setup ---
  const config = new DocumentBuilder()
    .setTitle('ATS Fit API')
    .setDescription('API documentation for ATS Fit Backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
  // --- End Swagger setup ---

  // Resolve ResponseService instance
  const responseService = await app.resolve(ResponseService);

  // Global validation pipe for request validation
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      enableDebugMessages: true,
      disableErrorMessages: false,
      validateCustomDecorators: true,
      skipMissingProperties: false,
      skipNullProperties: false,
      skipUndefinedProperties: false,
      exceptionFactory: (validationErrors: ValidationError[] = []) => {
        return new BadRequestException({
          message: 'Validation failed',
          errors: validationErrors,
        });
      },
    }),
  );

  // Global response interceptor to wrap success responses
  app.useGlobalInterceptors(new ResponseInterceptor(responseService));

  // Global exception filter to format error responses
  app.useGlobalFilters(new AllExceptionsFilter(responseService));

  // Global middleware to assign request IDs
  const requestIdMiddleware = new RequestIdMiddleware(responseService);
  app.use((req: Request, res: Response, next: NextFunction) => {
    requestIdMiddleware.use(req, res, next);
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  await app.listen(3000);
}

void bootstrap();
