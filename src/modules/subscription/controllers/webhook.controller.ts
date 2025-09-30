import { Controller, Post, Headers, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WebhookService } from '../services/webhook.service';
import { WebhookEventDto } from '../dtos/webhook.dto';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('lemon-squeezy')
  @ApiOperation({ summary: 'Handle LemonSqueezy webhook events' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid webhook payload' })
  async handleWebhook(
    @Headers('x-signature') signature: string,
    @Body() payload: WebhookEventDto,
  ) {
    return await this.webhookService.handleWebhook(signature, payload);
  }

  
}