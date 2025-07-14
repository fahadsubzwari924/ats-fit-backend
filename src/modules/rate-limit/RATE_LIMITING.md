# Rate Limit Module

## Overview

The **Rate Limit Module** provides robust, flexible, and scalable rate limiting and usage tracking for your NestJS application.  
It supports both registered and guest users, and allows you to apply rate limiting and usage tracking to specific endpoints using decorators and guards/interceptors.

---

## Features

- **Multi-factor user context:**  
  Distinguishes between registered and guest users using JWT, DB lookup, guest ID, IP, and user-agent.
- **Per-feature rate limiting:**  
  Apply different limits for different features/endpoints using the `@RateLimitFeature` decorator.
- **Usage tracking:**  
  Tracks feature usage in the `usage_tracking` table for analytics and enforcement.
- **Configurable:**  
  Rate limits are managed via the `rate_limit_config` table and can be initialized/updated as needed.
- **NestJS idiomatic:**  
  Uses guards, interceptors, and decorators for clean, modular integration.

---

## Usage

### 1. **Apply to Endpoints**

To enable rate limiting and usage tracking for an endpoint:

```typescript
@Post('score')
@Public() // If endpoint should be accessible by guests
@RateLimitFeature(FeatureType.ATS_SCORE)
@UseGuards(RateLimitGuard)
@UseInterceptors(FileInterceptor('resumeFile'), UsageTrackingInterceptor)
async calculateAtsScore(...) { ... }
```

- `@RateLimitFeature(FeatureType.X)`: Marks the endpoint for rate limiting and tracking.
- `@UseGuards(RateLimitGuard)`: Enforces rate limits and builds user context.
- `@UseInterceptors(UsageTrackingInterceptor)`: Records usage after successful response.

### 2. **User Context**

- **Registered users:** Identified via JWT and DB lookup.
- **Guest users:** Identified via guest ID, IP, and user-agent.

### 3. **Configuration**

- **Rate limits** are defined in the `rate_limit_config` table.
- **Usage** is tracked in the `usage_tracking` table.

---

## Key Components

- **rate-limit.guard.ts:**  
  Builds user context and enforces rate limits per feature.
- **usage-tracking.interceptor.ts:**  
  Records usage after successful requests.
- **rate-limit.service.ts:**  
  Core logic for checking limits, recording usage, and fetching stats.
- **rate-limit.controller.ts:**  
  Endpoints for querying usage statistics.
- **rate-limit.module.ts:**  
  Module definition and dependency wiring.

---

## Best Practices

- **Apply guards/interceptors only to endpoints that need rate limiting/tracking.**
- **Do not use as a global guard/interceptor** if only some endpoints require limits.
- **Keep user logic in `UserService` and user module** for separation of concerns.

---

## Example: Get Usage Stats

```typescript
@Get('usage')
@Public()
async getUsageStats(@Request() req) {
  // Returns usage stats for current user or guest
}
```

---

## Extending

- Add new features to `FeatureType` enum and configure limits in `rate_limit_config`.
- Customize user context logic in `UserService` as needed.

---

## License