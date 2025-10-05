# ATS Fit Backend - Manual Deployment Scripts

This directory contains comprehensive scripts for manual deployment and management of the ATS Fit Backend application following engineering best practices.

## 📂 Organized Structure

Scripts are now organized into logical categories for better maintainability:

- **`deployment/`** - Application deployment and environment management
- **`database/`** - Database operations, migrations, and management
- **`setup/`** - Infrastructure provisioning and configuration
- **`utilities/`** - Development tools and maintenance utilities
- **`legacy/`** - Archived scripts kept for reference

## 🚀 Quick Start

**Single Command Deployment:**

```bash
npm run deploy
# OR
./scripts/deploy.sh
```

## 📋 Available Scripts

### 🔧 Deployment Scripts

| Command                  | Description                       |
| ------------------------ | --------------------------------- |
| `npm run deploy`         | Deploy to production              |
| `npm run deploy:dev`     | Deploy to development environment |
| `npm run deploy:staging` | Deploy to staging environment     |
| `npm run deploy:prod`    | Deploy to production environment  |

### 📊 Environment Management

| Command            | Description                             |
| ------------------ | --------------------------------------- |
| `npm run logs`     | View production logs                    |
| `npm run logs:dev` | View development logs                   |
| `npm run status`   | Check production service status         |
| `npm run scale`    | Scale production service                |
| `npm run rollback` | Rollback production to previous version |

### 🗄️ Database Operations

| Command              | Description                     |
| -------------------- | ------------------------------- |
| `npm run db:migrate` | Run database migrations         |
| `npm run db:seed`    | Seed database with initial data |
| `npm run db:backup`  | Create database backup          |
| `npm run db:connect` | Connect to database via proxy   |
| `npm run db:status`  | Check database status           |

### 🛠️ Development Utilities

| Command                | Description              |
| ---------------------- | ------------------------ |
| `npm run dev:test-api` | Test API endpoints       |
| `npm run dev:health`   | Check service health     |
| `npm run dev:metrics`  | View service metrics     |
| `npm run dev:logs`     | View filtered logs       |
| `npm run dev:cleanup`  | Clean up local resources |
| `npm run dev:validate` | Validate configuration   |

## 🏗️ Engineering Best Practices

### ✅ **Error Handling**

- Comprehensive error checking with `set -euo pipefail`
- Graceful error messages and rollback capabilities
- Proper exit codes for CI/CD integration

### ✅ **Security**

- No hardcoded credentials
- All secrets retrieved from Google Secret Manager
- Proper IAM role-based access

### ✅ **Logging & Monitoring**

- Colored output for better readability
- Detailed logging for troubleshooting
- Pre and post-deployment validation

### ✅ **Environment Management**

- Support for multiple environments (dev/staging/prod)
- Environment-specific configurations
- Resource scaling per environment

### ✅ **Database Management**

- Safe migration handling
- Backup and restore capabilities
- Connection management via Cloud SQL Proxy

### ✅ **Cost Optimization**

- Manual deployment (no CI/CD costs)
- Environment-specific resource allocation
- Cleanup utilities to remove unused resources

## 📁 Script Architecture

```
scripts/
├── deployment/        # Deployment and environment management
│   ├── deploy.sh         # Main deployment script
│   ├── env-manager.sh    # Multi-environment management
│   └── post-deploy.sh    # Post-deployment verification
├── database/          # Database operations and management
│   ├── db-manager.sh     # Complete database operations suite
│   ├── migrate-database.sh # Database migration runner
│   ├── run-migrations.sh   # TypeORM migration executor
│   └── init-db.sql       # Database initialization SQL
├── setup/             # Infrastructure setup and configuration
│   ├── setup-gcp.sh      # Google Cloud Platform setup
│   ├── setup-database.sh # Database server configuration
│   ├── setup-redis.sh    # Redis/Memorystore setup
│   ├── create-secrets.sh # Secret Manager configuration
│   └── redis-recovery.sh # Redis recovery tools
├── utilities/         # Development and maintenance utilities
│   ├── dev-utils.sh      # Development testing and debugging
│   └── update-placeholders.sh # Template updater
└── legacy/           # Deprecated scripts (kept for reference)
    └── setup-migrations.sh # Legacy migration setup
```

## 🔧 Prerequisites

1. **Google Cloud CLI**

   ```bash
   # Install gcloud CLI
   curl https://sdk.cloud.google.com | bash

   # Authenticate
   gcloud auth login
   gcloud auth application-default login
   ```

2. **Docker**

   ```bash
   # Install Docker Desktop
   # https://www.docker.com/products/docker-desktop
   ```

3. **Project Access**
   ```bash
   # Verify access
   gcloud projects describe ats-fit-backend
   ```

## 🚀 Deployment Process

The deployment script follows these steps:

1. **Pre-deployment Checks**
   - Verify dependencies (gcloud, docker)
   - Check authentication
   - Validate project access

2. **Environment Configuration**
   - Load secrets from Secret Manager
   - Configure environment variables
   - Verify database and Redis connectivity

3. **Build & Push**
   - Build Docker image with optimizations
   - Tag with timestamp for tracking
   - Push to Google Container Registry

4. **Deploy to Cloud Run**
   - Deploy with comprehensive configuration
   - Set up Cloud SQL connections
   - Configure auto-scaling parameters

5. **Post-deployment Verification**
   - Health checks
   - Connectivity tests
   - Performance validation

## 🛡️ Safety Features

- **Rollback Capability**: Easy rollback to previous versions
- **Environment Isolation**: Separate dev/staging/prod environments
- **Backup Management**: Automated database backups
- **Resource Monitoring**: Built-in metrics and logging

## 📈 Scaling & Monitoring

**Scaling:**

```bash
npm run scale  # Interactive scaling
```

**Monitoring:**

```bash
npm run status        # Service status
npm run dev:metrics   # Detailed metrics
npm run logs         # Real-time logs
```

## 🔍 Troubleshooting

**Common Issues:**

1. **Authentication Errors**

   ```bash
   gcloud auth login
   gcloud auth application-default login
   ```

2. **Docker Issues**

   ```bash
   # Restart Docker Desktop
   docker info  # Verify Docker is running
   ```

3. **Database Connection**

   ```bash
   npm run db:status  # Check database status
   npm run db:connect # Test connection
   ```

4. **Service Not Responding**
   ```bash
   npm run dev:health    # Check health status
   npm run dev:test-api  # Test endpoints
   ```

## 📞 Support

For issues or questions:

1. Check logs: `npm run dev:logs`
2. Validate config: `npm run dev:validate`
3. Review deployment status: `npm run status`

---

**Note:** These scripts are designed for manual deployment to avoid CI/CD costs while maintaining professional deployment standards.
