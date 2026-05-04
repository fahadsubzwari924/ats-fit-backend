import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ContactService } from './contact.service';
import { SubmitContactDto } from './dto/submit-contact.dto';

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a contact form message' })
  @ApiResponse({ status: 200, description: 'Message received' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async submit(
    @Body(new ValidationPipe({ whitelist: true })) dto: SubmitContactDto,
  ): Promise<{ message: string }> {
    await this.contactService.submit(dto);
    return {
      message:
        'Your message has been received. We will be in touch within 1–2 business days.',
    };
  }
}
