import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import * as path from 'path';

const envFile =
  process.env.NODE_ENV === 'production'
    ? '../config/.env.prod'
    : process.env.NODE_ENV === 'staging'
      ? '../config/.env.staging'
      : '../config/.env.dev';

config({ path: path.join(__dirname, envFile) });

const dbUrl = process.env.DATABASE_URL;

export const AppDataSource = new DataSource({
  type: 'postgres',
  ...(dbUrl
    ? { url: dbUrl }
    : {
        host: process.env.DATABASE_HOST || 'localhost',
        port: parseInt(process.env.DATABASE_PORT || '5432'),
        username: process.env.DATABASE_USERNAME || 'postgres',
        password: process.env.DATABASE_PASSWORD || '',
        database: process.env.DATABASE_NAME || 'ats_fit',
      }),
  entities: [__dirname + '/entities/*.entity.{js,ts}'],
  migrations: [__dirname + '/migrations/*.{js,ts}'],
  migrationsTableName: 'migrations',
  synchronize: false,
  logging: true,
});
