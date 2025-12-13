# Email Template System - Architecture Documentation

## Overview

This email system follows **SOLID principles** and implements a **layered architecture** for fetching templates from S3 and rendering them with dynamic data.

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│         Email Service (AwsSesService)           │
│  - Sends emails via AWS SES                     │
│  - Validates email addresses                    │
│  - Orchestrates template fetching & rendering   │
└────────────────┬──────────────┬─────────────────┘
                 │              │
                 ▼              ▼
┌────────────────────┐  ┌────────────────────────┐
│  Template Provider │  │  Template Renderer     │
│  (S3)              │  │  (Handlebars)          │
│  - Fetches from S3 │  │  - Renders templates   │
│  - Caches content  │  │  - Custom helpers      │
└────────────────────┘  └────────────────────────┘
```

## SOLID Principles Applied

### 1. Single Responsibility Principle (SRP)
- **AwsSesService**: Only sends emails via SES
- **S3TemplateProviderService**: Only fetches templates from S3
- **HandlebarsTemplateRendererService**: Only renders templates

### 2. Open/Closed Principle (OCP)
- System is open for extension (can add new providers/renderers)
- Closed for modification (existing code doesn't change)
- Example: Add database provider by implementing `ITemplateProvider`

### 3. Liskov Substitution Principle (LSP)
- Any `ITemplateProvider` implementation can replace S3Provider
- Any `ITemplateRenderer` implementation can replace HandlebarsRenderer

### 4. Interface Segregation Principle (ISP)
- Small, focused interfaces: `ITemplateProvider`, `ITemplateRenderer`
- Clients only depend on methods they use

### 5. Dependency Inversion Principle (DIP)
- High-level module (`AwsSesService`) depends on abstractions
- Not on concrete implementations (`S3TemplateProviderService`)

## Components

### 1. Interfaces (Abstractions)

#### `ITemplateProvider`
```typescript
interface ITemplateProvider {
  fetchTemplate(params: TemplateFetchParams): Promise<TemplateContent>;
  templateExists(params: TemplateFetchParams): Promise<boolean>;
  invalidateCache(templateKey: string): void;
}
```

#### `ITemplateRenderer`
```typescript
interface ITemplateRenderer {
  render(
    templateSource: { subject?: string; html?: string; text?: string },
    context: RenderContext,
  ): Promise<RenderedTemplate>;
}
```

### 2. Implementations

#### `S3TemplateProviderService`
- Fetches templates from S3 bucket
- Supports two structures:
  1. **Structured**: `email-templates/{key}/subject.hbs`, `html.hbs`, `text.hbs`
  2. **Single file**: `email-templates/{key}.hbs`
- In-memory caching with TTL
- Automatic fallback between structures

#### `HandlebarsTemplateRendererService`
- Renders Handlebars templates
- Custom helpers: `uppercase`, `lowercase`, `currency`, `formatDate`, etc.
- Template compilation caching

#### `AwsSesService`
- Sends emails via AWS SES
- Email address validation
- Automatic template fetching and rendering
- Comprehensive error handling

## Usage

### Basic Email Sending

```typescript
import { Inject } from '@nestjs/common';
import { EMAIL_SERVICE_TOKEN, IEmailService } from '@shared/interfaces/email.interface';

class YourService {
  constructor(
    @Inject(EMAIL_SERVICE_TOKEN)
    private readonly emailService: IEmailService,
  ) {}

  async sendEmail() {
    // Direct content (no template)
    await this.emailService.send('user@example.com', {
      subject: 'Welcome!',
      html: '<h1>Hello World</h1>',
      text: 'Hello World',
    });
  }
}
```

### Template-Based Email

```typescript
async sendTemplateEmail() {
  await this.emailService.send('user@example.com', {
    templateKey: 'payment-failed',  // Matches S3 key
    templateData: {
      userName: 'John Doe',
      amount: '$29.99',
      reason: 'Insufficient funds',
      year: new Date().getFullYear(),
    },
  });
}
```

### Template Structure in S3

**Bucket**: `ats-fit-email-templates`

**Option 1 - Structured (Recommended)**:
```
email-templates/
  payment-failed/
    subject.hbs  → "Payment Failed for {{userName}}"
    html.hbs     → Full HTML template
    text.hbs     → Plain text version
```

**Option 2 - Single File**:
```
email-templates/
  payment-failed.hbs  → HTML-only template
```

### Handlebars Helpers

```handlebars
<!-- Uppercase -->
{{uppercase userName}}  → JOHN DOE

<!-- Currency -->
{{currency 2999}}  → $29.99

<!-- Date formatting -->
{{formatDate createdAt}}  → November 16, 2025

<!-- Conditional -->
{{#if isPremium}}
  <p>Premium user content</p>
{{/if}}

<!-- Comparison -->
{{#if (gt amount 100)}}
  <p>Large payment</p>
{{/if}}

<!-- Default value -->
{{default userName "Guest"}}
```

## Error Handling

All errors use custom exceptions from `@shared/exceptions`:

```typescript
- EMAIL_TEMPLATE_NOT_FOUND: Template doesn't exist in S3
- EMAIL_TEMPLATE_RENDER_FAILED: Handlebars rendering error
- EMAIL_SEND_FAILED: AWS SES send failure
- INVALID_EMAIL_ADDRESS: Invalid recipient email
- TEMPLATE_FETCH_FAILED: S3 fetch error
```

## Caching Strategy

### Template Content Cache (S3Provider)
- **TTL**: 10 minutes (configurable via `TEMPLATE_CACHE_TTL`)
- **Key**: `{bucket}:{templateKey}`
- **Invalidation**: Manual via `invalidateCache(templateKey)`

### Compiled Template Cache (HandlebarsRenderer)
- **Storage**: In-memory Map
- **Key**: Hash of template source
- **Invalidation**: Manual via `clearCache()`

## Testing Strategy

### Unit Tests

```typescript
describe('S3TemplateProviderService', () => {
  it('should fetch template from S3');
  it('should cache fetched templates');
  it('should invalidate cache');
  it('should throw NotFoundException when template not found');
});

describe('HandlebarsTemplateRendererService', () => {
  it('should render template with data');
  it('should apply custom helpers');
  it('should handle missing variables gracefully');
});

describe('AwsSesService', () => {
  it('should send email with direct content');
  it('should send email with template');
  it('should validate email addresses');
  it('should throw BadRequestException for invalid email');
});
```

## Extending the System

### Add New Template Provider (e.g., Database)

```typescript
@Injectable()
class DatabaseTemplateProvider implements ITemplateProvider {
  async fetchTemplate(params: TemplateFetchParams): Promise<TemplateContent> {
    // Fetch from database
    const template = await this.templateRepo.findOne({ key: params.templateKey });
    return {
      subject: template.subject,
      html: template.html,
      text: template.text,
    };
  }
  
  // Implement other methods...
}

// Register in module
{
  provide: TEMPLATE_PROVIDER_TOKEN,
  useClass: DatabaseTemplateProvider,  // Swap provider
}
```

### Add New Renderer (e.g., EJS)

```typescript
@Injectable()
class EjsTemplateRenderer implements ITemplateRenderer {
  async render(templateSource, context): Promise<RenderedTemplate> {
    return {
      subject: ejs.render(templateSource.subject, context),
      html: ejs.render(templateSource.html, context),
      text: ejs.render(templateSource.text, context),
    };
  }
}

// Register in module
{
  provide: TEMPLATE_RENDERER_TOKEN,
  useClass: EjsTemplateRenderer,  // Swap renderer
}
```

## Performance Considerations

1. **Caching**: Templates are cached in-memory for fast access
2. **Lazy Loading**: Templates fetched only when needed
3. **Compiled Templates**: Handlebars compiles once, reuses many times
4. **S3 Circuit Breaker**: S3Service has built-in retry and circuit breaker
5. **Async Operations**: All I/O is asynchronous

## Security

1. **Email Validation**: Regex validation before sending
2. **S3 Permissions**: Read-only access to template bucket
3. **Input Sanitization**: Handlebars auto-escapes HTML by default
4. **Error Messages**: No sensitive data in error responses

## Monitoring

Add logging for:
- Template fetch success/failure
- Render duration
- Email send success/failure
- Cache hit/miss ratios

## Migration from Disk Templates

Old system stored templates at `src/shared/templates/{key}/`.
New system fetches from S3 `email-templates/{key}/`.

**Migration steps**:
1. Run `npm run seed:email-templates` to upload templates
2. Verify templates in S3 bucket
3. System automatically uses S3 (no code changes needed)
4. Optional: Delete old `src/shared/templates` folder

## Environment Variables

```env
# Required
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=ap-south-1

# Optional (with defaults)
AWS_S3_EMAIL_TEMPLATES_BUCKET=ats-fit-email-templates
AWS_SES_FROM_EMAIL=info@atsfitt.com
AWS_SES_FROM_NAME=ATS Fit
TEMPLATE_CACHE_TTL=600000  # 10 minutes
```

## Benefits

✅ **Maintainable**: Clear separation of concerns
✅ **Testable**: Each component can be tested in isolation
✅ **Scalable**: Easy to add new providers/renderers
✅ **Flexible**: Swap implementations without changing client code
✅ **Performant**: Multi-layer caching strategy
✅ **Reliable**: Comprehensive error handling
✅ **Type-safe**: Full TypeScript support
