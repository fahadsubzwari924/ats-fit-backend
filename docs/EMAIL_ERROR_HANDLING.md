# Email Notification Error Handling - Engineering Best Practices

## Overview

The email notification system is designed with **fail-safe architecture** to ensure that email sending failures **never disrupt critical business processes** like payment processing, subscription management, or user registration.

## Problem Statement

**Before**: Email sending errors would throw exceptions and halt critical flows:
```typescript
// ❌ BAD: Throws exception, stops payment processing
await emailService.send(user.email, {...});
// If email fails, payment confirmation stops here!
```

**After**: Email sending is graceful and non-blocking:
```typescript
// ✅ GOOD: Never throws, continues flow
await emailNotificationService.sendSafe(user.email, {...});
// Payment processing continues regardless of email result
```

## Architecture

### EmailNotificationService

A wrapper service around `IEmailService` that implements:

1. **Fail-Safe Pattern** - Never throws exceptions
2. **Circuit Breaker** - Prevents cascading failures
3. **Retry Mechanism** - Automatic retry with exponential backoff
4. **Comprehensive Logging** - All failures tracked
5. **Observability** - Metrics for monitoring

```
┌─────────────────────────────────────────┐
│   Business Logic (Subscription)         │
│   - Payment processing                  │
│   - User registration                   │
│   - Critical workflows                  │
└─────────────────┬───────────────────────┘
                  │
                  │ (non-blocking)
                  ▼
┌─────────────────────────────────────────┐
│   EmailNotificationService              │
│   - Fail-safe wrapper                   │
│   - Retry logic                         │
│   - Circuit breaker                     │
│   - Error logging                       │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│   AwsSesService (IEmailService)         │
│   - S3 templates                        │
│   - AWS SES sending                     │
└─────────────────────────────────────────┘
```

## Engineering Best Practices Applied

### 1. Fail-Safe Pattern

**Principle**: Email notifications are **secondary concerns** - they should never block primary business logic.

```typescript
// Critical business process
async handleFailedPayment(payload: any, user: User) {
  this.logger.log(`Processing failed payment for user: ${user.email}`);

  // ✅ Email sent asynchronously - doesn't block
  this.emailNotificationService.sendSafe(user.email, {...})
    .then(result => {
      if (result.success) {
        this.logger.log('Email sent successfully');
      } else {
        this.logger.warn(`Email failed: ${result.error}`);
        // Business logic continues regardless
      }
    });

  // ✅ Primary logic continues immediately
  this.logger.log('Payment processing completed');
}
```

### 2. Circuit Breaker Pattern

Prevents cascading failures when email service is down.

**How it works**:
- Tracks consecutive email failures
- Opens circuit after 10 consecutive failures
- Skips email sending when circuit is open
- Auto-resets after 1 minute cooldown

```typescript
private isCircuitOpen(): boolean {
  const now = Date.now();
  
  // Auto-reset after cooldown
  if (this.circuitOpen && now - this.lastCircuitCheck > 60000) {
    this.resetCircuitBreaker();
  }
  
  return this.circuitOpen;
}
```

**Benefits**:
- Prevents overwhelming failing email service
- Fast-fails instead of waiting for timeouts
- Automatic recovery when service stabilizes

### 3. Retry Mechanism with Exponential Backoff

Transient failures (network issues, rate limits) are retried automatically.

```typescript
async sendSafe(to: string, payload: any, options?: EmailSendOptions) {
  const retries = options?.retries ?? 2; // Default: 3 attempts total
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await this.emailService.send(to, payload);
    } catch (error) {
      if (attempt < retries) {
        // Exponential backoff: 1s, 2s, 4s
        await this.delay(1000 * Math.pow(2, attempt));
      }
    }
  }
}
```

**Benefits**:
- Handles temporary failures (network blips)
- Exponential backoff prevents overwhelming service
- Configurable retry count

### 4. Multiple Send Patterns

Different patterns for different use cases:

#### Pattern A: Fire-and-Forget (Async)
Best for non-critical notifications.

```typescript
// Doesn't wait for result, doesn't block
await emailNotificationService.sendAsync(user.email, {...});
// Continues immediately
```

#### Pattern B: Safe Send with Result
Best when you need to know if email succeeded.

```typescript
const result = await emailNotificationService.sendSafe(user.email, {...});
if (result.success) {
  this.logger.log('Email sent');
} else {
  this.logger.warn(`Email failed: ${result.error}`);
}
// Flow continues regardless
```

#### Pattern C: Send with Callbacks
Best for conditional logic based on result.

```typescript
await emailNotificationService.sendWithCallback(
  user.email,
  {...},
  {
    onSuccess: (result) => {
      metrics.increment('email.sent');
    },
    onFailure: (result) => {
      metrics.increment('email.failed');
      // Maybe queue for retry later
    }
  }
);
```

#### Pattern D: Batch Send
Send to multiple recipients with failure isolation.

```typescript
const result = await emailNotificationService.sendBatch([
  { to: 'user1@example.com', payload: {...} },
  { to: 'user2@example.com', payload: {...} },
]);
// result: { total: 2, successful: 1, failed: 1 }
```

### 5. Comprehensive Logging

Every failure is logged with full context for debugging:

```typescript
this.logger.error('Email send failed after all retries', {
  to: user.email,
  templateKey: 'payment-failed',
  subject: 'Payment Failed',
  error: error.message,
  stack: error.stack,
  attempts: 3,
  consecutiveFailures: 5,
});
```

**Log Levels**:
- `DEBUG`: Each retry attempt
- `LOG`: Successful sends
- `WARN`: Single attempt failures, circuit opened
- `ERROR`: All retries exhausted, critical issues

### 6. Observability & Monitoring

Built-in metrics for monitoring:

```typescript
// Get circuit breaker status
const status = emailNotificationService.getCircuitStatus();
// {
//   isOpen: false,
//   consecutiveFailures: 0,
//   lastCheck: Date,
//   willResetAt: Date
// }
```

**Monitoring Recommendations**:
- Alert when circuit breaker opens
- Track email success/failure rates
- Monitor retry frequency
- Set up dead letter queue for failed emails

## Usage Examples

### Example 1: Payment Failure Notification

```typescript
async handleFailedPayment(payload: any, user: User) {
  // Critical: Process payment failure
  await this.updatePaymentStatus(payload);
  
  // Non-critical: Send email notification
  this.emailNotificationService.sendSafe(user.email, {
    templateKey: EmailTemplates.PAYMENT_FAILED,
    templateData: {
      userName: user.full_name,
      amount: payload.amount,
      reason: payload.failureReason,
      year: new Date().getFullYear(),
    },
    subject: 'Payment Failed',
  });
  
  // ✅ Returns immediately, email sent in background
}
```

### Example 2: User Registration Welcome Email

```typescript
async registerUser(userData: CreateUserDto) {
  // Critical: Create user account
  const user = await this.userRepository.save(userData);
  
  // Non-critical: Send welcome email (fire-and-forget)
  await this.emailNotificationService.sendAsync(user.email, {
    templateKey: EmailTemplates.WELCOME,
    templateData: {
      firstName: user.firstName,
      loginUrl: 'https://app.atsfitt.com/login',
    },
  });
  
  // ✅ User created even if email fails
  return user;
}
```

### Example 3: Subscription Renewal Reminder

```typescript
async sendRenewalReminders(users: User[]) {
  const result = await this.emailNotificationService.sendBatch(
    users.map(user => ({
      to: user.email,
      payload: {
        templateKey: EmailTemplates.RENEWAL_REMINDER,
        templateData: {
          userName: user.name,
          renewalDate: user.subscription.renewsAt,
        },
      },
    }))
  );
  
  this.logger.log(`Renewal reminders: ${result.successful} sent, ${result.failed} failed`);
  // ✅ Individual failures don't affect others
}
```

## Error Scenarios Handled

### Scenario 1: AWS SES Down
```
Circuit breaker opens after 10 failures
→ Emails skipped until service recovers
→ Business logic unaffected
→ Alert sent to ops team
```

### Scenario 2: Invalid Email Address
```
Retry doesn't help (permanent failure)
→ Logs error with user details
→ Returns failure result
→ Business logic continues
```

### Scenario 3: S3 Template Not Found
```
Retries with exponential backoff
→ If still fails, logs error
→ Returns failure result
→ Business logic continues
```

### Scenario 4: Network Timeout
```
Retry #1: Wait 1s, retry
Retry #2: Wait 2s, retry
Retry #3: Wait 4s, final attempt
→ If all fail, log and continue
```

## Migration Guide

### Before (Blocking)

```typescript
// ❌ This throws and stops the flow
try {
  await this.emailService.send(user.email, {...});
} catch (error) {
  // Even with try-catch, we're wasting time waiting for failure
  this.logger.error('Email failed', error);
  throw error; // Stops payment processing!
}
```

### After (Non-Blocking)

```typescript
// ✅ This never throws, continues immediately
this.emailNotificationService.sendSafe(user.email, {...})
  .then(result => {
    if (!result.success) {
      this.logger.warn('Email failed but process continues');
    }
  });
// Payment processing continues
```

## Performance Impact

- **Latency**: Zero impact on critical flows (fire-and-forget)
- **Throughput**: Unchanged (emails sent async)
- **Reliability**: Improved (failures don't cascade)
- **Resource Usage**: Minimal (circuit breaker prevents overload)

## Future Enhancements

### 1. Dead Letter Queue (DLQ)
Queue failed emails for retry:
```typescript
if (!result.success) {
  await this.queueService.addToRetryQueue({
    to: user.email,
    payload,
    attemptedAt: new Date(),
  });
}
```

### 2. Rate Limiting
Prevent overwhelming email provider:
```typescript
const rateLimiter = new RateLimiter({
  maxPerMinute: 100,
  maxPerHour: 1000,
});
```

### 3. Fallback Email Provider
Switch to backup if primary fails:
```typescript
if (!awsSesResult.success) {
  return await sendgridService.send(...);
}
```

### 4. Email Analytics
Track open rates, click rates:
```typescript
await this.analyticsService.trackEmailSent({
  to: user.email,
  template: 'payment-failed',
  sentAt: new Date(),
});
```

## Testing

### Unit Test Example

```typescript
describe('EmailNotificationService', () => {
  it('should continue on email failure', async () => {
    // Mock email service to throw
    emailService.send.mockRejectedValue(new Error('SES down'));
    
    // Should not throw
    const result = await emailNotificationService.sendSafe(
      'test@example.com',
      {...}
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('SES down');
  });
  
  it('should open circuit breaker after 10 failures', async () => {
    // Simulate 10 failures
    for (let i = 0; i < 10; i++) {
      await emailNotificationService.sendSafe('test@example.com', {...});
    }
    
    const status = emailNotificationService.getCircuitStatus();
    expect(status.isOpen).toBe(true);
  });
});
```

## Summary

✅ **Email failures never block critical business logic**
✅ **Automatic retries for transient failures**
✅ **Circuit breaker prevents cascading failures**
✅ **Comprehensive logging for debugging**
✅ **Zero performance impact on critical flows**
✅ **Production-ready with monitoring support**

This implementation ensures **high availability** and **resilience** while maintaining excellent **observability** for debugging and monitoring.
