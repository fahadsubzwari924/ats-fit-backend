# Email Template System - Quick Start Guide

## 🚀 Quick Start

### 1. Upload Templates to S3
```bash
npm run seed:email-templates
```

### 2. Send Email with Template
```typescript
import { Inject } from '@nestjs/common';
import { EMAIL_SERVICE_TOKEN, IEmailService } from '@shared/interfaces/email.interface';

@Injectable()
class YourService {
  constructor(
    @Inject(EMAIL_SERVICE_TOKEN)
    private emailService: IEmailService
  ) {}

  async sendEmail() {
    await this.emailService.send('user@example.com', {
      templateKey: 'payment-failed',
      templateData: {
        userName: 'John Doe',
        amount: '$29.99',
        reason: 'Insufficient funds',
        year: 2025
      }
    });
  }
}
```

## 📁 Template Structure in S3

**Bucket**: `ats-fit-email-templates`

### Option 1: Multi-file Template (Recommended)
```
email-templates/
  payment-failed/
    subject.hbs    → Email subject line
    html.hbs       → HTML email body
    text.hbs       → Plain text version
```

### Option 2: Single File
```
email-templates/
  payment-failed.hbs    → HTML only
```

## 🎨 Template Example

**File**: `email-templates/payment-failed.hbs`

```handlebars
<!DOCTYPE html>
<html>
<head>
    <title>Payment Failed</title>
</head>
<body>
    <h1>Payment Failed</h1>
    
    <p>Dear {{userName}},</p>
    
    <p>Your payment of <strong>{{amount}}</strong> failed.</p>
    <p>Reason: {{reason}}</p>
    
    {{#if (gt amount 100)}}
        <p style="color: red;">High-value payment - please resolve immediately.</p>
    {{/if}}
    
    <footer>
        <p>&copy; {{year}} ATS Fit</p>
    </footer>
</body>
</html>
```

## 🔧 Available Handlebars Helpers

| Helper | Usage | Example | Output |
|--------|-------|---------|--------|
| `uppercase` | `{{uppercase name}}` | `{{uppercase "john"}}` | `JOHN` |
| `lowercase` | `{{lowercase name}}` | `{{lowercase "JOHN"}}` | `john` |
| `capitalize` | `{{capitalize name}}` | `{{capitalize "john doe"}}` | `John doe` |
| `currency` | `{{currency amount}}` | `{{currency 2999}}` | `$29.99` |
| `formatDate` | `{{formatDate date}}` | `{{formatDate createdAt}}` | `November 16, 2025` |
| `eq` | `{{#if (eq a b)}}` | `{{#if (eq status "paid")}}` | Boolean |
| `neq` | `{{#if (neq a b)}}` | `{{#if (neq status "failed")}}` | Boolean |
| `gt` | `{{#if (gt a b)}}` | `{{#if (gt amount 100)}}` | Boolean |
| `lt` | `{{#if (lt a b)}}` | `{{#if (lt age 18)}}` | Boolean |
| `or` | `{{#if (or a b)}}` | `{{#if (or isPremium isTrial)}}` | Boolean |
| `and` | `{{#if (and a b)}}` | `{{#if (and isActive isPaid)}}` | Boolean |
| `default` | `{{default value "Guest"}}` | `{{default userName "Guest"}}` | Fallback value |
| `truncate` | `{{truncate text 50}}` | `{{truncate description 100 "..."}}` | Truncated text |

## 📝 Common Use Cases

### Payment Failure
```typescript
await emailService.send(userEmail, {
  templateKey: 'payment-failed',
  templateData: {
    userName: 'John Doe',
    amount: '$29.99',
    reason: 'Card expired',
    year: new Date().getFullYear()
  }
});
```

### Welcome Email
```typescript
await emailService.send(userEmail, {
  templateKey: 'welcome',
  templateData: {
    firstName: 'John',
    lastName: 'Doe',
    planName: 'Premium',
    loginUrl: 'https://app.atsfitt.com/login',
    year: new Date().getFullYear()
  }
});
```

### ATS Score Report
```typescript
await emailService.send(userEmail, {
  templateKey: 'ats-score-report',
  templateData: {
    userName: 'John Doe',
    atsScore: 85,
    jobTitle: 'Software Engineer',
    matchedKeywords: ['JavaScript', 'React', 'Node.js'],
    missingKeywords: ['TypeScript', 'AWS'],
    reportUrl: 'https://app.atsfitt.com/reports/123',
    year: new Date().getFullYear()
  }
});
```

## 🔍 Debugging

### Check if Template Exists
```typescript
const exists = await emailService.templateExists('payment-failed');
console.log('Template exists:', exists);
```

### Clear Template Cache
```typescript
emailService.invalidateTemplate('payment-failed');
```

### View Logs
Look for these log messages:
- `Fetching template from S3: {templateKey}`
- `Template rendered successfully: {templateKey}`
- `Email sent successfully to {email}`

## ⚠️ Common Errors

| Error Code | Cause | Solution |
|------------|-------|----------|
| `EMAIL_TEMPLATE_NOT_FOUND` | Template doesn't exist in S3 | Upload template with `npm run seed:email-templates` |
| `EMAIL_TEMPLATE_RENDER_FAILED` | Syntax error in template | Check Handlebars syntax |
| `EMAIL_SEND_FAILED` | AWS SES error | Check AWS credentials and SES verification |
| `INVALID_EMAIL_ADDRESS` | Invalid email format | Validate email before sending |

## 🔐 Environment Variables

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

## 📚 More Information

- **Full Documentation**: `docs/EMAIL_TEMPLATE_SYSTEM.md`
- **Usage Examples**: `src/shared/services/email-examples.service.ts`
- **Architecture**: See SOLID principles section in full docs

## 🆘 Support

Need help? Contact the development team or check:
1. AWS SES dashboard for email sending status
2. S3 bucket `ats-fit-email-templates` for template files
3. Application logs for detailed error messages
