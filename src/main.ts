import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  ValidationPipe,
  VersioningType,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ResponseService } from './shared/modules/response/response.service';
import { ResponseInterceptor } from './shared/modules/response/response.interceptor';
import { AllExceptionsFilter } from './shared/modules/response/exception.filter';
import { RequestIdMiddleware } from './shared/modules/response/request-id.middleware';
import { Request, Response, NextFunction } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { lemonSqueezySetup } from '@lemonsqueezy/lemonsqueezy.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Lemon Squeezy SDK setup
  lemonSqueezySetup({
    apiKey: process.env.LEMON_SQUEEZY_API_KEY,
    onError: (error) => {
      logger.error('Payment gateway SDK Error:', error);
      // Optionally throw or handle
    },
  });

  // Enable graceful shutdown for Cloud Run
  app.enableShutdownHooks();

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

  // Cloud Run expects app to listen on PORT environment variable
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Application is running on port ${port}`);

  // Ngrok setup for local development only
  await setupNgrokTunnel(port, logger);
}

/**
 * Setup Ngrok tunnel for local development
 * Only runs when ENABLE_NGROK=true and NODE_ENV is 'development' or 'local'
 */
async function setupNgrokTunnel(port: number | string, logger: Logger) {
  logger.log(`ENV: ${process.env.NODE_ENV}`);
  const isLocalDevelopment =
    process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'local';
  const enableNgrok = process.env.ENABLE_NGROK === 'true';

  if (!isLocalDevelopment || !enableNgrok) {
    logger.log('Ngrok tunnel disabled (not in local development mode)');
    return;
  }

  if (!process.env.NGROK_AUTH_TOKEN) {
    logger.warn(
      'NGROK_AUTH_TOKEN not set. Skipping ngrok tunnel setup. Set ENABLE_NGROK=true and NGROK_AUTH_TOKEN to enable.',
    );
    return;
  }

  try {
    // Dynamically import ngrok only when needed
    const { authtoken, forward } = await import('@ngrok/ngrok');

    await authtoken(process.env.NGROK_AUTH_TOKEN);
    const tunnel = await forward({ addr: port });

    logger.log(`✅ Ngrok tunnel established: ${tunnel.url()}`);
    logger.log(
      `📱 Use this URL for webhooks and external access: ${tunnel.url()}`,
    );
  } catch (error) {
    logger.error('Failed to setup ngrok tunnel:', error);
    logger.warn('Application will continue without ngrok tunnel');
  }
}

void bootstrap();
