import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminInviteThrottleGuard } from '../guards/admin-invite-throttle.guard';
import { BetaInviteService } from '../services/beta-invite.service';
import { InviteBetaUsersDto } from '../dtos/invite-beta-users.dto';
import { AdminListQueryDto } from '../dtos/admin-list-query.dto';

@Controller('beta/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminBetaController {
  constructor(private readonly betaInviteService: BetaInviteService) {}

  @Post('invite')
  @UseGuards(AdminInviteThrottleGuard)
  async inviteUsers(@Body() dto: InviteBetaUsersDto) {
    return this.betaInviteService.createInvites(dto);
  }

  @Post('revoke/:id')
  async revokeInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string; revoke_active_access?: boolean },
  ) {
    return this.betaInviteService.revokeInvite(
      id,
      body.reason ?? '',
      body.revoke_active_access ?? false,
    );
  }

  @Get('list')
  async listInvites(@Query() query: AdminListQueryDto) {
    return this.betaInviteService.findAllPaginated(query);
  }
}
