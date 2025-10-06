# Environment Variable Management Guide

This document explains how environment variables are managed across different environments in the ATS Fit Backend application.

## 🏗️ Architecture Overview

The application uses a **multi-environment configuration system** with proper separation of concerns:

- **Development**: Direct values in `.env.dev` for local development
- **Staging**: Environment variable substitution with `${VARIABLE}` syntax
- **Production**: Google Secret Manager integration via Cloud Run

## 📁 File Structure

```
src/config/
├── .env.dev              # Development environment (actual values)
├── .env.staging          # Staging environment (${VAR} placeholders)
├── .env.prod             # Production environment (${VAR} placeholders)
├── .env.dev.template     # Development template (for new developers)
├── .env.staging.template # Staging template (for CI/CD setup)
├── .env.prod.template    # Production template (reference only)
└── configuration.ts      # NestJS configuration loader
```

## 🔧 Environment-Specific Configuration

### Development Environment

**File**: `src/config/.env.dev`

Contains **actual values** for local development:

```bash
NODE_ENV=development
DATABASE_HOST=localhost
DATABASE_PORT=5433
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=your_actual_password_here
OPENAI_API_KEY=sk-your-actual-api-key-here
# ... more variables with real values
```

### Staging Environment

**File**: `src/config/.env.staging`

Uses **environment variable substitution**:

```bash
NODE_ENV=staging
DATABASE_HOST=${DATABASE_HOST}
DATABASE_PASSWORD=${DATABASE_PASSWORD}
OPENAI_API_KEY=${OPENAI_API_KEY}
# ... variables populated from CI/CD or runtime environment
```

### Production Environment

**File**: `src/config/.env.prod`

Uses **Google Secret Manager** through Cloud Run:

```bash
NODE_ENV=production
DATABASE_HOST=${DATABASE_HOST}
DATABASE_PASSWORD=${DATABASE_PASSWORD}
# ... variables populated from Secret Manager in cloud-run-service.yaml
```

## 🔒 Secret Management

### Local Development

- Use actual values in `.env.dev`
- File is gitignored for security

### Production Deployment

- Secrets stored in **Google Secret Manager**
- Cloud Run service definition (`cloud-run-service.yaml`) maps secrets:

```yaml
env:
  - name: DATABASE_PASSWORD
    valueFrom:
      secretKeyRef:
        name: database-password
        key: latest
```

## 🚀 Setup Instructions

### For New Developers

1. **Copy the development template**:

   ```bash
   cp src/config/.env.dev.template src/config/.env.dev
   ```

2. **Fill in actual values**:

   ```bash
   # Edit src/config/.env.dev with your actual API keys, passwords, etc.
   nano src/config/.env.dev
   ```

3. **Start development**:
   ```bash
   npm run dev
   ```

### For Production Deployment

1. **Create secrets in Google Secret Manager**:

   ```bash
   # Edit the script with actual values first
   ./scripts/setup/create-secrets.sh
   ```

2. **Deploy to Cloud Run**:
   ```bash
   ./scripts/deployment/deploy.sh
   ```

## 🔄 Configuration Loading Logic

The application automatically loads the correct environment file based on `NODE_ENV`:

```typescript
// src/config/configuration.ts
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
```

## 📋 Environment Variables Reference

### Core Application

- `NODE_ENV` - Environment type (development|staging|production)
- `PORT` - Application port (8080 for Cloud Run)

### Database Configuration

- `DATABASE_HOST` - Database host/connection string
- `DATABASE_PORT` - Database port (5432 for prod, 5433 for dev)
- `DATABASE_USERNAME` - Database username
- `DATABASE_PASSWORD` - Database password
- `DATABASE_NAME` - Database name

### Redis Configuration

- `REDIS_HOST` - Redis server host
- `REDIS_PORT` - Redis server port (default: 6379)
- `REDIS_PASSWORD` - Redis authentication password

### Authentication

- `JWT_SECRET` - JWT signing secret
- `JWT_EXPIRES_IN` - JWT token expiration (default: 24h)

### AI Services

- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic (Claude) API key
- `OPENAI_MAX_RETRIES` - OpenAI retry attempts
- `CLAUDE_MAX_RETRIES` - Claude retry attempts

### AWS Services

- `AWS_ACCESS_KEY_ID` - AWS access key
- `AWS_SECRET_ACCESS_KEY` - AWS secret key
- `AWS_REGION` - AWS region (ap-south-1)
- `AWS_S3_BUCKET` - S3 bucket name
- `AWS_S3_RESUME_TEMPLATES_BUCKET` - Resume templates bucket

### Performance Tuning

- `CACHE_TTL` - Cache time-to-live in milliseconds
- `PDF_TIMEOUT` - PDF generation timeout
- `MAX_FILE_SIZE` - Maximum upload file size
- `MAX_SKILLS_FOR_EMBEDDING` - AI processing limit

## 🛡️ Security Best Practices

### ✅ Do's

- Use Secret Manager for production secrets
- Keep `.env.dev` with actual values for development
- Use `${VARIABLE}` syntax for staging/production
- Regularly rotate API keys and passwords
- Use strong, unique passwords for each environment

### ❌ Don'ts

- Never commit actual secrets to git
- Don't use production secrets in development
- Avoid hardcoding secrets in deployment files
- Don't share `.env.dev` files between developers

## 🔍 Troubleshooting

### Environment Not Loading

```bash
# Check if the correct .env file exists
ls -la src/config/.env.*

# Verify NODE_ENV is set correctly
echo $NODE_ENV
```

### Missing Variables

```bash
# Check what variables are loaded
npm run config:validate

# View current environment configuration
npm run config:show
```

### Secret Manager Issues

```bash
# Test secret access
gcloud secrets versions access latest --secret="database-password"

# Check service account permissions
gcloud projects get-iam-policy ats-fit-backend
```

## 📚 Related Documentation

- [Docker Setup Guide](DOCKER_SETUP_GUIDE.md)
- [Deployment Guide](../scripts/deployment/README.md)
- [Security Guidelines](SECURITY_GUIDELINES.md)

## 🤝 Contributing

When adding new environment variables:

1. Add to all three environment files (dev, staging, prod)
2. Update the configuration.ts file if needed
3. Add to the Secret Manager setup script for production
4. Update this documentation
5. Update the validation schema in `validation.schema.ts`
