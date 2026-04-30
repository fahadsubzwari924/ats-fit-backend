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
  AWS_S3_GENERATED_RESUMES_BUCKET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
  AWS_S3_EMAIL_TEMPLATES_BUCKET: Joi.string().optional(),

  // OpenAI configuration
  OPENAI_API_KEY: Joi.string().required(),
  OPENAI_MODEL: Joi.string().default('gpt-4-turbo'),

  // LemonSqueezy configuration (optional for now)
  LEMON_SQUEEZY_API_KEY: Joi.string().optional().allow(''),
  LEMON_SQUEEZY_STORE_ID: Joi.string().optional().allow(''),
  LEMON_SQUEEZY_WEBHOOK_SECRET: Joi.string().optional().allow(''),
  // Optional: discount/coupon code applied to Pro Monthly checkouts for founding-rate-locked users
  LS_FOUNDING_COUPON_CODE: Joi.string().optional().allow(''),

  // App configuration
  APP_URL: Joi.string().optional().default('http://localhost:3000'),
  APP_ENV: Joi.string()
    .valid('development', 'production')
    .default('development'),

  // Brevo transactional email
  BREVO_API_KEY: Joi.string().optional().allow(''),
  BREVO_FROM_EMAIL: Joi.string().email().optional().default('hello@tairly.com'),
  BREVO_FROM_NAME: Joi.string().optional().default('Tailry'),
  BREVO_TEMPLATE_ID_PASSWORD_RESET: Joi.number().optional(),
  BREVO_TEMPLATE_ID_PASSWORD_CHANGED: Joi.number().optional(),
  // Beta access email templates (set after creating templates in Brevo dashboard)
  BREVO_TEMPLATE_ID_BETA_INVITE: Joi.number().optional(),
  BREVO_TEMPLATE_ID_BETA_REDEEMED_WELCOME: Joi.number().optional(),
  BREVO_TEMPLATE_ID_BETA_EXPIRING_SOON: Joi.number().optional(),
  BREVO_TEMPLATE_ID_BETA_ENDED_OFFER: Joi.number().optional(),
  BREVO_TEMPLATE_ID_BETA_POST_EXPIRY_FOLLOWUP: Joi.number().optional(),
  BREVO_TEMPLATE_ID_BETA_DAY3_CHECKIN: Joi.number().optional(),

  // Frontend URL (used to build reset links in emails)
  FRONTEND_URL: Joi.string().default('http://localhost:4200'),

  // Performance configuration
  TEMPLATE_CACHE_TTL: Joi.number().default(600000), // 10 minutes in milliseconds
  RESUME_SERVICE_CACHE_TTL: Joi.number().default(300000), // 5 minutes in milliseconds
  MAX_SKILLS_FOR_EMBEDDING: Joi.number().default(10),
  MAX_MISSING_SKILLS: Joi.number().default(5),
  PDF_TIMEOUT: Joi.number().default(15000), // 15 seconds in milliseconds
  PDF_PAGE_TIMEOUT: Joi.number().default(10000), // 10 seconds in milliseconds
  MAX_FILE_SIZE: Joi.number().default(5242880), // 5MB in bytes
});
