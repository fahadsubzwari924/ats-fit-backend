<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

# ATS-Fit Backend

A NestJS backend service for generating tailored resumes using AI analysis and customizable templates.

## Performance Optimizations

The resume generation endpoint has been optimized to reduce response time from ~39 seconds to significantly faster times. Here are the key optimizations implemented:

### 1. Parallel Processing
- **Template fetching and PDF text extraction** now run in parallel using `Promise.all()`
- **AI analysis operations** (keyword extraction and resume embedding) are parallelized
- **Skill embedding generation** for multiple skills runs concurrently

### 2. Caching Strategy
- **Template content caching**: S3 template content is cached for 10 minutes (configurable)
- **Resume service caching**: Template objects are cached for 5 minutes (configurable)
- **Database query caching**: Template metadata queries use TypeORM caching

### 3. AI Service Optimizations
- **Limited skill analysis**: Only top 10 skills are processed for embeddings (configurable)
- **Reduced missing skills**: Limited to top 5 most relevant missing skills (configurable)
- **Eliminated redundant analysis**: Combined resume analysis into main method

### 4. PDF Generation Improvements
- **Browser reuse**: Puppeteer browser instance is reused across requests
- **Faster page loading**: Changed from `networkidle0` to `domcontentloaded` wait strategy
- **Optimized browser args**: Added performance-focused Chrome flags
- **Configurable timeouts**: PDF generation timeouts are now configurable

### 5. Configuration-Driven Performance
All performance settings are configurable via environment variables:

```env
# Template caching (milliseconds)
TEMPLATE_CACHE_TTL=600000
RESUME_SERVICE_CACHE_TTL=300000

# AI optimization
MAX_SKILLS_FOR_EMBEDDING=10
MAX_MISSING_SKILLS=5

# PDF generation timeouts (milliseconds)
PDF_TIMEOUT=15000
PDF_PAGE_TIMEOUT=10000

# File size limits (bytes)
MAX_FILE_SIZE=5242880
```

### 6. Performance Monitoring
The service now logs detailed timing information for each step:
- Template and text extraction time
- AI analysis time
- Template application time
- PDF generation time
- Total processing time

### Expected Performance Improvements
- **Template fetching**: ~2-3 seconds → ~100-200ms (with cache)
- **AI analysis**: ~15-20 seconds → ~8-12 seconds (parallel processing)
- **PDF generation**: ~8-10 seconds → ~3-5 seconds (browser reuse)
- **Overall**: ~39 seconds → ~12-18 seconds (60-70% improvement)

## Features

- AI-powered resume analysis and tailoring
- Multiple professional resume templates
- PDF generation with custom styling
- JWT authentication
- AWS S3 integration for template storage
- Configurable performance settings

## Installation

```bash
npm install
```

## Configuration

Set up your environment variables in `config/.env.dev` or `config/.env.prod`:

```env
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=password
DATABASE_NAME=ats_fit

# JWT
JWT_SECRET=your-secret-key

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_RESUME_TEMPLATES_BUCKET=your-templates-bucket

# OpenAI
OPENAI_API_KEY=your-openai-key
```

## Running the Application

```bash
# Development
npm run start:dev

# Production
npm run start:prod
```

## API Endpoints

### Authentication
- `POST /auth/signup` - User registration
- `POST /auth/signin` - User login

### Resume Generation
- `GET /resumes/templates` - Get available templates
- `POST /resumes/generate` - Generate tailored resume (requires authentication)

## License

MIT
