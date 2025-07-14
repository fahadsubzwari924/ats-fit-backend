# Rate Limiting System Documentation

## Overview

The ATS Fit backend implements a comprehensive rate limiting and user management system that enforces usage limits based on user plans and types. This system ensures fair usage of the platform's features while providing scalability and security.

## Architecture

### Core Components

1. **User Management System**
   - Handles both guest and registered users
   - Tracks user sessions and IP addresses
   - Manages user plans and types

2. **Rate Limiting Engine**
   - Enforces monthly usage limits per feature
   - Provides caching for performance optimization
   - Supports configurable limits per plan and user type

3. **Usage Tracking**
   - Records feature usage in real-time
   - Maintains historical usage data
   - Supports analytics and monitoring

## User Types and Plans

### User Types
- **Guest Users**: Non-registered users identified by IP address and user agent
- **Registered Users**: Authenticated users with accounts

### Plans
- **Freemium**: Basic plan with limited usage
- **Premium**: Advanced plan with higher limits (future use)

## Feature Limits

### Freemium Plan
| User Type | Resume Generation | ATS Score |
|-----------|------------------|-----------|
| Guest     | 2 per month      | 5 per month |
| Registered| 5 per month      | 10 per month |

### Premium Plan (Future)
| User Type | Resume Generation | ATS Score |
|-----------|------------------|-----------|
| Registered| 50 per month     | 100 per month |

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  full_name VARCHAR NOT NULL,
  email VARCHAR UNIQUE NOT NULL,
  password VARCHAR NOT NULL,
  plan VARCHAR DEFAULT 'freemium',
  user_type VARCHAR DEFAULT 'registered',
  guest_id VARCHAR,
  ip_address VARCHAR,
  user_agent VARCHAR,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Usage Tracking Table
```sql
CREATE TABLE usage_tracking (
  id UUID PRIMARY KEY,
  user_id UUID,
  guest_id VARCHAR,
  ip_address VARCHAR,
  feature_type VARCHAR NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  usage_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP
);
```

### Rate Limit Config Table
```sql
CREATE TABLE rate_limit_configs (
  id UUID PRIMARY KEY,
  plan VARCHAR NOT NULL,
  user_type VARCHAR NOT NULL,
  feature_type VARCHAR NOT NULL,
  monthly_limit INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## API Endpoints

### Rate Limit Information
- `GET /api/v1/rate-limits/usage` - Get current usage statistics (public)
- `GET /api/v1/rate-limits/usage/authenticated` - Get usage for authenticated users

### Protected Endpoints
- `POST /api/v1/resumes/generate` - Resume generation (rate limited)
- `POST /api/v1/ats-match/score` - ATS score calculation (rate limited)

## Implementation Details

### Rate Limiting Guard
The `RateLimitGuard` automatically checks usage limits before allowing access to protected endpoints:

```typescript
@RateLimitFeature(FeatureType.RESUME_GENERATION)
@Post('generate')
async generateResume() {
  // Implementation
}
```

### Usage Tracking Interceptor
The `UsageTrackingInterceptor` automatically records successful feature usage:

```typescript
// Automatically records usage after successful response
// No manual intervention required
```

### User Context Management
The system automatically handles user identification:

- **Guest Users**: Identified by IP address and user agent
- **Registered Users**: Identified by JWT token

## Security Features

### Anti-Abuse Measures
1. **IP Address Tracking**: Prevents VPN abuse by tracking IP changes
2. **User Agent Tracking**: Additional identification layer
3. **Guest User Limits**: Stricter limits for non-registered users
4. **Session Management**: Tracks user sessions across requests

### Rate Limiting Strategies
1. **Monthly Limits**: Resets on the first day of each month
2. **Caching**: Reduces database load with in-memory caching
3. **Graceful Degradation**: Returns detailed error messages when limits exceeded

## Performance Optimizations

### Caching Strategy
- **In-Memory Cache**: 5-minute TTL for usage data
- **LRU Eviction**: Automatic cleanup of old cache entries
- **Database Optimization**: Indexed queries for fast lookups

### Database Indexes
```sql
-- Usage tracking indexes
CREATE INDEX idx_usage_user_feature_month_year ON usage_tracking(user_id, feature_type, month, year);
CREATE INDEX idx_usage_guest_feature_month_year ON usage_tracking(guest_id, feature_type, month, year);
CREATE INDEX idx_usage_ip_feature_month_year ON usage_tracking(ip_address, feature_type, month, year);

-- Rate limit config indexes
CREATE UNIQUE INDEX idx_rate_limit_config ON rate_limit_configs(plan, user_type, feature_type);
```

## Error Handling

### Rate Limit Exceeded Response
```json
{
  "message": "Rate limit exceeded for resume_generation",
  "errorCode": "RATE_LIMIT_EXCEEDED",
  "details": {
    "currentUsage": 5,
    "limit": 5,
    "remaining": 0,
    "resetDate": "2024-02-01T00:00:00.000Z",
    "feature": "resume_generation",
    "userType": "registered",
    "plan": "freemium"
  }
}
```

## Setup and Configuration

### 1. Database Migration
Run the database migrations to create the required tables:
```bash
npm run migration:run
```

### 2. Seed Rate Limit Configurations
Initialize the default rate limit configurations:
```bash
npm run seed:rate-limits
```

### 3. Environment Variables
Ensure the following environment variables are set:
```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=your_username
DATABASE_PASSWORD=your_password
DATABASE_NAME=your_database
JWT_SECRET=your_jwt_secret
```

## Monitoring and Analytics

### Usage Statistics
The system provides real-time usage statistics:
```json
{
  "resume_generation": {
    "allowed": true,
    "currentUsage": 3,
    "limit": 5,
    "remaining": 2,
    "resetDate": "2024-02-01T00:00:00.000Z"
  },
  "ats_score": {
    "allowed": true,
    "currentUsage": 7,
    "limit": 10,
    "remaining": 3,
    "resetDate": "2024-02-01T00:00:00.000Z"
  },
  "userType": "registered",
  "plan": "freemium"
}
```

### Logging
The system logs important events:
- Rate limit violations
- Usage tracking events
- User creation and identification
- Cache operations

## Scalability Considerations

### Horizontal Scaling
- **Stateless Design**: No server-side session storage
- **Database Sharding**: Usage tracking can be sharded by user ID
- **Cache Distribution**: Redis can replace in-memory cache for multi-instance deployments

### Future Enhancements
1. **Dynamic Limits**: Admin-configurable limits without code changes
2. **Usage Analytics**: Detailed usage reports and insights
3. **Plan Upgrades**: Seamless plan transitions
4. **Feature Flags**: Enable/disable features per plan
5. **Usage Alerts**: Notifications when approaching limits

## Testing

### Unit Tests
```bash
npm run test
```

### Integration Tests
```bash
npm run test:e2e
```

### Manual Testing
1. Test guest user limits
2. Test registered user limits
3. Test rate limit exceeded scenarios
4. Test usage statistics endpoints

## Troubleshooting

### Common Issues

1. **Rate Limit Not Working**
   - Check if rate limit configurations are seeded
   - Verify database connections
   - Check cache status

2. **Guest User Not Identified**
   - Verify IP address extraction
   - Check user agent headers
   - Review database constraints

3. **Performance Issues**
   - Monitor cache hit rates
   - Check database query performance
   - Review index usage

### Debug Mode
Enable debug logging by setting the log level:
```typescript
// In your application
Logger.logLevel = 'debug';
```

## Conclusion

This rate limiting system provides a robust, scalable, and secure foundation for managing feature usage in the ATS Fit platform. It balances user experience with business requirements while maintaining high performance and security standards. 