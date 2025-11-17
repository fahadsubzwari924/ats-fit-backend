#!/usr/bin/env ts-node

/**
 * Standalone script to upload email templates to S3
 * Run this script independently without needing the full NestJS application context
 * 
 * Usage:
 *   npm run seed:email-templates
 *   or
 *   ts-node src/scripts/seed/upload-email-templates-standalone.ts
 */

import './upload-email-templates-to-s3';
