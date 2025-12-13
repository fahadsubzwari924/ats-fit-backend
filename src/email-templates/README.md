# Email Templates

This directory contains email templates used by the application. Templates are stored both locally and synced to S3.

## Directory Structure

```
email-templates/
├── payment-failed.hbs          # Payment failure notification
└── [other templates...]
```

## Template Format

Templates use Handlebars (.hbs) syntax for dynamic content injection.

### Example Variables

- `{{userName}}` - User's name
- `{{amount}}` - Payment amount
- `{{reason}}` - Failure reason
- `{{year}}` - Current year

## Uploading to S3

### Quick Start

To upload all email templates to S3, run:

```bash
npm run seed:email-templates
```

### What It Does

The seed script:
1. ✅ Scans `src/email-templates` recursively for `.hbs` and `.html` files
2. ✅ Preserves directory structure in S3
3. ✅ Uploads to bucket: `ats-fit-email-templates`
4. ✅ Sets correct content types (`text/x-handlebars-template` or `text/html`)
5. ✅ Adds metadata (originalName, uploadedAt, source)
6. ✅ Shows upload progress and summary

### S3 Structure

Files are uploaded with the following structure:

```
s3://ats-fit-email-templates/
└── email-templates/
    ├── payment-failed.hbs
    └── [subdirectories preserved...]
```

### Environment Requirements

Ensure these variables are set in `.env.dev` or `.env.prod`:

- `AWS_BUCKET_REGION` - AWS region (e.g., `us-east-1`)
- `AWS_ACCESS_KEY_ID` - AWS access key
- `AWS_SECRET_ACCESS_KEY` - AWS secret key

### Manual Upload

The standalone script is located at:
```
src/scripts/seed/upload-email-templates-to-s3.ts
```

## Adding New Templates

1. Create your `.hbs` or `.html` file in this directory (or a subdirectory)
2. Use Handlebars syntax for dynamic content: `{{variableName}}`
3. Run `npm run seed:email-templates` to sync to S3
4. Update your email service to reference the new template

## Best Practices

- ✅ Use semantic template names (e.g., `payment-failed.hbs`, `welcome-email.hbs`)
- ✅ Keep templates focused on a single purpose
- ✅ Test templates locally before uploading
- ✅ Document required variables in comments
- ✅ Sync to S3 after any changes
