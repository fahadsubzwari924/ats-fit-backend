import * as dotenv from 'dotenv';
import * as path from 'path';
const envFile =
  process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev';
const envPath = path.resolve(__dirname, '../../config', envFile);
dotenv.config({ path: envPath });

import * as fs from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DataSource } from 'typeorm';
import { ResumeTemplate } from '../../database/entities/resume-templates.entity';

const region = process.env.AWS_BUCKET_REGION;
console.log('region: ', region);

const s3 = new S3Client({ region });
const bucketName = process.env.AWS_S3_RESUME_TEMPLATES_BUCKET;

if (!bucketName) {
  throw new Error('AWS_S3_RESUME_TEMPLATES_BUCKET is not set in env file');
}

const templatesBaseDir = path.resolve(__dirname, '../../resume-templates');

export async function seedResumeTemplates(dataSource: DataSource) {
  const repo = dataSource.getRepository(ResumeTemplate);
  const folders = fs.readdirSync(templatesBaseDir).filter((folder) => {
    const fullPath = path.join(templatesBaseDir, folder);
    return fs.statSync(fullPath).isDirectory();
  });

  console.log('folders: ', folders);

  for (const folder of folders) {
    const folderPath = path.join(templatesBaseDir, folder);
    console.log('folderPath: ', folderPath);
    if (!fs.statSync(folderPath).isDirectory()) continue;

    const keyPrefix = `ats-friendly-resume-templates/${folder}`;
    const name = folder
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());

    // Read template.html and thumbnail
    const htmlPath = path.join(folderPath, 'template.html');
    const thumbnailPath = fs
      .readdirSync(folderPath)
      .find((f) => f.startsWith('thumbnail'));

    if (!fs.existsSync(htmlPath) || !thumbnailPath) {
      console.warn(`Skipping ${folder}: Missing required files.`);
      continue;
    }

    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const thumbnailContent = fs.readFileSync(
      path.join(folderPath, thumbnailPath),
    );

    // Upload HTML
    const htmlKey = `${keyPrefix}/template.html`;
    const templateUloadResponse = await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: htmlKey,
        Body: htmlContent,
        ContentType: 'text/html',
      }),
    );

    console.log('template upload response: ', templateUloadResponse);

    // Upload Thumbnail
    const thumbnailKey = `${keyPrefix}/${thumbnailPath}`;
    const templateThumbnailResponse = await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: thumbnailKey,
        Body: thumbnailContent,
        ContentType: thumbnailPath.endsWith('.png')
          ? 'image/png'
          : 'image/jpeg',
      }),
    );
    console.log(
      'template thumbnail upload response: ',
      templateThumbnailResponse,
    );

    const s3Url = `https://${bucketName}.s3.${region}.amazonaws.com/${htmlKey}`;
    const thumbnailUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${thumbnailKey}`;

    // Save to DB
    const template = repo.create({
      name,
      key: folder,
      remote_url: s3Url,
      thumbnail_image_url: thumbnailUrl,
      description: `ATS-friendly template: ${name}`,
    });

    await repo.save(template);
    console.log(`Seeded template: ${name}`);
  }

  console.log('All templates seeded successfully.');
}
