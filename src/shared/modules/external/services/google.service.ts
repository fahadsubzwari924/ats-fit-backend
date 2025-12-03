// openai.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { UnauthorizedException } from '../../../exceptions/custom-http-exceptions';
import { ERROR_CODES } from 'src/shared/constants/error-codes';


@Injectable()
export class GoogleService {
    private readonly logger = new Logger(GoogleService.name);
    private readonly oAuth2Client: OAuth2Client;
    private readonly googleClientId: string;

    constructor(
        private readonly jwtService: JwtService,
        private configService: ConfigService
    ) {
        // Get the Client ID from environment variables (recommended)
        this.googleClientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
        
        if (!this.googleClientId) {
        throw new Error('GOOGLE_CLIENT_ID not configured in environment.');
        }
        this.oAuth2Client = new OAuth2Client(this.googleClientId);
    }

    async login(idToken: string): Promise<TokenPayload> {
        try {
            let payload: TokenPayload;

            // 1. Verify the ID Token
            const ticket = await this.oAuth2Client.verifyIdToken({
                idToken,
                audience: this.googleClientId,
            });
            payload = ticket.getPayload();

            this.logger.log(`Google token payload: ${JSON.stringify(payload)}`);
            
            if (!payload) {
                throw new UnauthorizedException(
                    'Invalid Google token payload', 
                    ERROR_CODES.GOOGLE_USER_NOT_AUTHENTICATED
                );
            }

            return payload;
        } catch (e) {
            this.logger.error('Token verification error:', e);
            throw new UnauthorizedException('Google token validation failed');
        }

    }
    
}