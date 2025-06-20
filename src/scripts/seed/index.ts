import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { seedResumeTemplates } from './seed-resume-templates';
import { AppModule } from '../../app.module';

async function runSeed() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const dataSource = app.get(DataSource);
  await seedResumeTemplates(dataSource);

  await app.close();
  console.log('Seeding completed.');
}

runSeed().catch((err) => {
  console.error('Error during seeding:', err);
  process.exit(1);
});
