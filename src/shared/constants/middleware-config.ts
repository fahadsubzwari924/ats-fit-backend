/**
 * Configuration for middleware behavior
 */
export const MIDDLEWARE_CONFIG = {
  /**
   * Paths that should skip user context middleware
   * These endpoints don't require user authentication or context
   */
  SKIP_USER_CONTEXT_PATHS: [
    '/webhooks',      // Payment webhooks, system webhooks
    '/health',        // Health check endpoints
    '/metrics',       // Monitoring/metrics endpoints
    '/docs',          // API documentation (Swagger)
    '/favicon.ico',   // Static assets
    // Add more paths here as needed:
    // '/public-api',    // Public API endpoints
    // '/system-status', // System status endpoints
    // '/monitoring',    // Monitoring endpoints
  ],

  /**
   * Paths that should have relaxed rate limiting
   * These endpoints might need different rate limiting rules
   */
  RELAXED_RATE_LIMIT_PATHS: [
    '/webhooks',
    '/health',
  ],

  /**
   * Paths that should skip request logging
   * These endpoints generate too much noise in logs
   */
  SKIP_REQUEST_LOGGING_PATHS: [
    '/health',
    '/metrics',
    '/favicon.ico',
  ],
} as const;

/**
 * Helper function to check if a path matches any of the configured patterns
 * @param requestPath The request path to check
 * @param configuredPaths Array of paths to match against
 * @returns boolean indicating if the path should be skipped
 */
export function shouldSkipForPath(requestPath: string, configuredPaths: readonly string[]): boolean {
  return configuredPaths.some(skipPath => 
    requestPath.includes(skipPath) || requestPath.startsWith(skipPath)
  );
}

/**
 * Helper function specifically for user context middleware
 * @param req Express Request object
 * @returns boolean indicating whether to skip user context middleware
 */
export function shouldSkipUserContext(req: { originalUrl?: string; url: string; path: string }): boolean {
  const fullPath = req.originalUrl || req.url;
  const requestPath = req.path;
  
  return shouldSkipForPath(fullPath, MIDDLEWARE_CONFIG.SKIP_USER_CONTEXT_PATHS) ||
         shouldSkipForPath(requestPath, MIDDLEWARE_CONFIG.SKIP_USER_CONTEXT_PATHS);
}