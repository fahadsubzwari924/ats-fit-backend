import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),

  // Database configuration
  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_USERNAME: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),

  // JWT configuration
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('24h'),

  // AWS configuration
  AWS_REGION: Joi.string().required(),
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  AWS_S3_RESUME_TEMPLATES_BUCKET: Joi.string().required(),
  AWS_S3_GENERATED_RESUMES_BUCKET: Joi.string().optional(),

  // OpenAI configuration
  OPENAI_API_KEY: Joi.string().required(),
  OPENAI_MODEL: Joi.string().default('gpt-4-turbo'),

  // Performance configuration
  TEMPLATE_CACHE_TTL: Joi.number().default(600000), // 10 minutes in milliseconds
  RESUME_SERVICE_CACHE_TTL: Joi.number().default(300000), // 5 minutes in milliseconds
  MAX_SKILLS_FOR_EMBEDDING: Joi.number().default(10),
  MAX_MISSING_SKILLS: Joi.number().default(5),
  PDF_TIMEOUT: Joi.number().default(15000), // 15 seconds in milliseconds
  PDF_PAGE_TIMEOUT: Joi.number().default(10000), // 10 seconds in milliseconds
  MAX_FILE_SIZE: Joi.number().default(5242880), // 5MB in bytes
});
