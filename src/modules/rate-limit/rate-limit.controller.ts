import { Controller, Get, UseGuards, Request, Logger } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RateLimitService } from './rate-limit.service';
import { UserService } from '../user/user.service';
import { Public } from '../auth/decorators/public.decorator';
import { Request as ExpressRequest } from 'express';
import { UserContext } from '../auth/types/user-context.type';

@ApiTags('Rate Limits')
@Controller('rate-limits')
export class RateLimitController {
  private readonly logger = new Logger(RateLimitController.name);

  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly userService: UserService,
  ) {}

  @Get('usage')
  @Public()
  @ApiOperation({ summary: 'Get current usage statistics' })
  @ApiResponse({
    status: 200,
    description: 'Usage statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        resume_generation: {
          type: 'object',
          properties: {
            allowed: { type: 'boolean' },
            currentUsage: { type: 'number' },
            limit: { type: 'number' },
            remaining: { type: 'number' },
            resetDate: { type: 'string', format: 'date-time' },
          },
        },
        ats_score: {
          type: 'object',
          properties: {
            allowed: { type: 'boolean' },
            currentUsage: { type: 'number' },
            limit: { type: 'number' },
            remaining: { type: 'number' },
            resetDate: { type: 'string', format: 'date-time' },
          },
        },
        userType: { type: 'string' },
        plan: { type: 'string' },
      },
    },
  })
  async getUsageStats(
    @Request() req: ExpressRequest & { user?: { userId?: string } },
  ) {
    try {
      let userContext: UserContext;

      // Check if user is authenticated
      if (req?.user && typeof req?.user?.userId === 'string') {
        userContext = await this.userService.getAuthenticatedUserContext(
          req.user.userId,
        );
      } else {
        // Get guest user context
        userContext = await this.userService.getOrCreateGuestUser(req);
      }

      const usageStats =
        await this.rateLimitService.getUserUsageStats(userContext);

      return {
        ...usageStats,
        userType: userContext.userType,
        plan: userContext.plan,
      };
    } catch (error) {
      this.logger.error('Error getting usage stats:', error);
      throw error;
    }
  }

  @Get('usage/authenticated')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get usage statistics for authenticated users' })
  @ApiResponse({
    status: 200,
    description: 'Usage statistics retrieved successfully',
  })
  async getAuthenticatedUsageStats(
    @Request() req: ExpressRequest & { user?: { userId?: string } },
  ) {
    const userId = req.user?.userId;
    if (typeof userId !== 'string') {
      throw new Error('Invalid user ID');
    }
    const userContext =
      await this.userService.getAuthenticatedUserContext(userId);
    const usageStats =
      await this.rateLimitService.getUserUsageStats(userContext);

    return {
      ...usageStats,
      userType: userContext.userType,
      plan: userContext.plan,
      userId: userContext.userId,
    };
  }
}
