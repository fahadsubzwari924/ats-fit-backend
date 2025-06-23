import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ResponseService } from './response.service';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly responseService: ResponseService) {}

  use(req: Request, res: Response, next: NextFunction) {
    req['requestId'] = this.responseService.getRequestId();
    next();
  }
}
