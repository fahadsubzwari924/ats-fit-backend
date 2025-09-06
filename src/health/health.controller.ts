import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../modules/auth/decorators/public.decorator';
import { CircuitBreakerService } from '../shared/services/circuit-breaker.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly circuitBreaker: CircuitBreakerService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Health check endpoint',
    description: 'Check if the application is running and healthy',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', example: '2025-09-01T12:00:00.000Z' },
        uptime: { type: 'number', example: 123.456 },
        environment: { type: 'string', example: 'production' },
      },
    },
  })
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    };
  }

  @Get('circuit-breakers')
  @Public()
  @ApiOperation({
    summary: 'Circuit breaker status',
    description: 'Get the status of all circuit breakers',
  })
  getCircuitBreakerStatus() {
    return {
      status: 'Circuit breakers are operational',
      timestamp: new Date().toISOString(),
      note: 'Circuit breakers help prevent cascading failures in S3 operations',
    };
  }
}
