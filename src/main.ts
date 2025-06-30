import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ResponseService } from './shared/modules/response/response.service';
import { ResponseInterceptor } from './shared/modules/response/response.interceptor';
import { AllExceptionsFilter } from './shared/modules/response/exception.filter';
import { RequestIdMiddleware } from './shared/modules/response/request-id.middleware';
import { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

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
bootstrap();
