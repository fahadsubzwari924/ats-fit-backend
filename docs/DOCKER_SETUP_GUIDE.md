# 🐳 Docker Setup Guide

Quick Docker setup for ATS Fit Backend - NestJS app with PostgreSQL and Redis.

## Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for local dev mode only)

## 🚀 Quick Start

### Development Mode (Recommended)

Run databases in Docker, app locally for easier debugging:

```bash
# 1. Edit environment
nano src/config/.env.dev  # Update API keys, passwords

# 2. Start databases
chmod +x run.sh && ./run.sh dev

# 3. Run app locally
npm install && npm run migration:run && npm run start:dev
```

**Access:** App: http://localhost:3000 | pgAdmin: http://localhost:5050

### Production Mode

Full Docker stack:

```bash
# 1. Edit environment
nano src/config/.env.prod  # Update ALL values

# 2. Build & start
./run.sh build && ./run.sh prod

# 3. Initialize (first time only)
./run.sh migrate && ./run.sh seed
```

**Access:** http://localhost:3000

## Essential Commands

```bash
./run.sh dev      # Start dev databases only
./run.sh prod     # Start full production stack
./run.sh build    # Build app image
./run.sh status   # Check services
./run.sh logs     # View logs
./run.sh stop     # Stop all services
./run.sh migrate  # Run DB migrations
./run.sh clean    # Remove everything
```

## Environment Variables

Required in `src/config/.env.dev` and `src/config/.env.prod`:

```bash
# Database
DATABASE_PASSWORD=your_password
DATABASE_NAME=ats_fit

# Security
JWT_SECRET=your_secure_secret

# APIs
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key

# AWS
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_S3_RESUME_TEMPLATES_BUCKET=your_bucket
```

## Troubleshooting

```bash
# Port conflicts (common issue)
sudo lsof -i :5432  # Check if PostgreSQL is already running
brew services stop postgresql@14  # Stop local PostgreSQL if needed

# Check what's using ports
lsof -i :3000   # App port
lsof -i :5433   # PostgreSQL Docker port
lsof -i :6379   # Redis port

# Check logs
./run.sh logs app  # App logs
./run.sh logs postgres-dev  # Database logs

# Reset everything
./run.sh clean && ./run.sh dev
```

**Note**: Development PostgreSQL runs on port **5433** to avoid conflicts with local PostgreSQL installations.

## Architecture

- **Development**: PostgreSQL + Redis in Docker, NestJS runs locally
- **Production**: Everything in Docker with health checks
- **Admin Tools**: pgAdmin (5050), Redis Commander (8081)
- **Networking**: Internal Docker network for service communication
