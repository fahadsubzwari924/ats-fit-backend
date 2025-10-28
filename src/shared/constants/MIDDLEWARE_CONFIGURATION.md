# Middleware Configuration Guide

This document explains how to configure middleware behavior for different API endpoints.

## Skip User Context Middleware

Some API endpoints don't require user authentication or context (like webhooks, health checks, etc.). Instead of hardcoding these paths in middleware, we use a centralized configuration system.

### Adding New Skip Paths

To add new endpoints that should skip user context middleware:

1. **Open the configuration file:**
   ```
   src/shared/constants/middleware-config.ts
   ```

2. **Add your path to the `SKIP_USER_CONTEXT_PATHS` array:**
   ```typescript
   SKIP_USER_CONTEXT_PATHS: [
     '/webhooks',      // Existing
     '/health',        // Existing
     '/metrics',       // Existing
     '/public-api',    // ✅ Your new path
     '/system-status', // ✅ Another new path
   ],
   ```

3. **That's it!** The middleware will automatically skip user context for these paths.

### Current Skip Paths

The following paths currently skip user context middleware:

- `/webhooks` - Payment webhooks, system webhooks
- `/health` - Health check endpoints
- `/metrics` - Monitoring/metrics endpoints
- `/docs` - API documentation (Swagger)
- `/favicon.ico` - Static assets

### Path Matching Logic

The system uses **contains** matching, so:
- `/webhooks` will match `/api/webhooks/stripe`, `/webhooks/payment`, etc.
- `/health` will match `/health`, `/api/health`, `/health/check`, etc.

### Future Extensions

The configuration file also includes placeholders for other middleware behaviors:

- **`RELAXED_RATE_LIMIT_PATHS`** - For endpoints that need different rate limiting
- **`SKIP_REQUEST_LOGGING_PATHS`** - For endpoints that generate too much noise in logs

### Usage in Other Middleware

You can use the same configuration system in other middleware:

```typescript
import { shouldSkipForPath, MIDDLEWARE_CONFIG } from '../constants/middleware-config';

// In your middleware
if (shouldSkipForPath(req.path, MIDDLEWARE_CONFIG.RELAXED_RATE_LIMIT_PATHS)) {
  // Apply relaxed rate limiting
}
```

### Benefits

1. **Centralized Configuration** - All skip paths in one place
2. **Easy to Extend** - Just add to the array, no code changes needed
3. **Consistent** - Same logic used across all middleware
4. **Type Safe** - TypeScript ensures configuration is correct
5. **Documented** - Clear comments explain what each path is for
6. **Reusable** - Helper functions can be used in multiple middleware

### Examples

```typescript
// ✅ Good - Easy to add new paths
SKIP_USER_CONTEXT_PATHS: [
  '/webhooks',
  '/health', 
  '/metrics',
  '/public-api',    // Just add here
  '/monitoring',    // And here
]

// ❌ Bad - Hardcoded in middleware
if (path.includes('/webhooks') || 
    path.includes('/health') || 
    path.includes('/metrics') ||
    path.includes('/public-api')) {
  // Skip middleware
}
```