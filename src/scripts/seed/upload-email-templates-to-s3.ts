/**
 * Email Templates S3 Upload Seed Script
 * 
 * This script uploads all email template files from src/email-templates to the S3 bucket.
 * 
 * Bucket: ats-fit-email-templates
 * 
 * Usage:
 *   npm run seed:email-templates
 * 
 * The script will:
 *   - Recursively scan src/email-templates for .hbs and .html files
 *   - Preserve directory structure in S3 (e.g., subdirs/template.hbs → email-templates/subdirs/template.hbs)
 *   - Set appropriate content types (text/x-handlebars-template or text/html)
 *   - Add metadata (originalName, uploadedAt, source)
 *   - Display upload progress and summary
 * 
 * Environment Variables Required:
 *   - AWS_BUCKET_REGION: The AWS region for the S3 bucket
 *   - AWS_ACCESS_KEY_ID: AWS credentials (loaded from .env.dev or .env.prod)
 *   - AWS_SECRET_ACCESS_KEY: AWS credentials (loaded from .env.dev or .env.prod)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
const envFile =
  process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev';
const envPath = path.resolve(__dirname, '../../config', envFile);
dotenv.config({ path: envPath });

import * as fs from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const region = process.env.AWS_BUCKET_REGION;
const s3Client = new S3Client({ region });

// Use the dedicated email templates bucket
const targetBucket = 'ats-fit-email-templates';

if (!region) {
  throw new Error('AWS_BUCKET_REGION is not set in environment variables');
}

const templatesBaseDir = path.resolve(__dirname, '../../email-templates');

interface UploadResult {
  file: string;
  key: string;
  url: string;
  success: boolean;
  error?: string;
}

/**
 * Recursively get all template files from a directory
 */
function getAllTemplateFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recursively get files from subdirectories
      files.push(...getAllTemplateFiles(fullPath, baseDir));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.hbs') || entry.name.endsWith('.html'))
    ) {
      // Store relative path from base directory
      const relativePath = path.relative(baseDir, fullPath);
      files.push(relativePath);
    }
  }

  return files;
}

async function uploadEmailTemplates(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Starting Email Templates Upload to S3');
  console.log('='.repeat(60));
  console.log(`Region: ${region}`);
  console.log(`Bucket: ${targetBucket}`);
  console.log(`Templates Directory: ${templatesBaseDir}`);
  console.log('='.repeat(60));

  if (!fs.existsSync(templatesBaseDir)) {
    console.error(`Templates directory does not exist: ${templatesBaseDir}`);
    process.exit(1);
  }

  // Get all template files recursively
  const files = getAllTemplateFiles(templatesBaseDir);

  if (files.length === 0) {
    console.warn('No email template files found to upload');
    return;
  }

  console.log(`Found ${files.length} template file(s) to upload:\n`);

  const results: UploadResult[] = [];

  for (const relativeFilePath of files) {
    const filePath = path.join(templatesBaseDir, relativeFilePath);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    
    // Preserve directory structure in S3 key, but normalize path separators
    const normalizedPath = relativeFilePath.replace(/\\/g, '/');
    const key = `email-templates/${normalizedPath}`;

    // Determine content type
    const contentType = relativeFilePath.endsWith('.hbs')
      ? 'text/x-handlebars-template'
      : 'text/html';

    console.log(`Uploading: ${relativeFilePath}`);
    console.log(`  → S3 Key: ${key}`);
    console.log(`  → Content Type: ${contentType}`);

    try {
      const command = new PutObjectCommand({
        Bucket: targetBucket,
        Key: key,
        Body: fileContent,
        ContentType: contentType,
        Metadata: {
          originalName: path.basename(relativeFilePath),
          uploadedAt: new Date().toISOString(),
          source: 'email-templates-seed-script',
        },
      });

      const response = await s3Client.send(command);
      const url = `https://${targetBucket}.s3.${region}.amazonaws.com/${key}`;

      console.log(`  ✓ Upload successful`);
      console.log(`  → ETag: ${response.ETag}`);
      console.log(`  → URL: ${url}\n`);

      results.push({
        file: relativeFilePath,
        key,
        url,
        success: true,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error(`  ✗ Upload failed: ${errorMessage}\n`);

      results.push({
        file: relativeFilePath,
        key,
        url: '',
        success: false,
        error: errorMessage,
      });
    }
  }

  // Print summary
  console.log('='.repeat(60));
  console.log('Upload Summary');
  console.log('='.repeat(60));

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`Total files: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);

  if (successful.length > 0) {
    console.log('\n✓ Successfully uploaded:');
    successful.forEach((r) => {
      console.log(`  - ${r.file}`);
      console.log(`    ${r.url}`);
    });
  }

  if (failed.length > 0) {
    console.log('\n✗ Failed uploads:');
    failed.forEach((r) => {
      console.log(`  - ${r.file}`);
      console.log(`    Error: ${r.error}`);
    });
  }

  console.log('='.repeat(60));

  // Exit with error if any uploads failed
  if (failed.length > 0) {
    process.exit(1);
  }
}

// Execute the upload
uploadEmailTemplates()
  .then(() => {
    console.log('✓ All email templates uploaded successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('✗ Error during upload process:', error);
    process.exit(1);
  });
