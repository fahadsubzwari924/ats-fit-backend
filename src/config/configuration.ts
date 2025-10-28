import { ConfigModule } from '@nestjs/config';

import { validationSchema } from './validation.schema';

const getEnvFilePath = () => {
  switch (process.env.NODE_ENV) {
    case 'production':
      return 'src/config/.env.prod';
    case 'staging':
      return 'src/config/.env.staging';
    case 'development':
    default:
      return 'src/config/.env.dev';
  }
};

export const configModule = ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: getEnvFilePath(),
  validationSchema,
  validationOptions: {
    abortEarly: false,
  },
});

export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  database: {
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT, 10) || 5432,
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  aws: {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3: {
      resumeTemplatesBucket: process.env.AWS_S3_RESUME_TEMPLATES_BUCKET,
      generatedResumesBucket: process.env.AWS_S3_GENERATED_RESUMES_BUCKET,
    },
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
  },
  performance: {
    // Template caching settings
    templateCacheTtl: parseInt(process.env.TEMPLATE_CACHE_TTL, 10) || 600000, // 10 minutes
    resumeServiceCacheTtl:
      parseInt(process.env.RESUME_SERVICE_CACHE_TTL, 10) || 300000, // 5 minutes

    // AI optimization settings
    maxSkillsForEmbedding:
      parseInt(process.env.MAX_SKILLS_FOR_EMBEDDING, 10) || 10,
    maxMissingSkills: parseInt(process.env.MAX_MISSING_SKILLS, 10) || 5,

    // PDF generation settings
    pdfTimeout: parseInt(process.env.PDF_TIMEOUT, 10) || 10000, // OPTIMIZATION: Reduced from 15000 to 10000
    pdfPageTimeout: parseInt(process.env.PDF_PAGE_TIMEOUT, 10) || 8000, // OPTIMIZATION: Reduced from 10000 to 8000

    // File size limits
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 5242880, // 5MB
  },
  lemonSqueezy: {
    apiKey: process.env.LEMON_SQUEEZY_API_KEY,
    storeId: process.env.LEMON_SQUEEZY_STORE_ID,
    webhookSecret: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,
  }
});
