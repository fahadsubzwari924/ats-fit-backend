import { ConfigModule } from '@nestjs/config';

import { validationSchema } from './validation.schema';

export const configModule = ConfigModule.forRoot({
  isGlobal: true,
  envFilePath:
    process.env.NODE_ENV === 'production'
      ? 'config/.env.prod'
      : 'config/.env.dev',
  validationSchema,
  validationOptions: {
    abortEarly: false,
  },
});
