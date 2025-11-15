import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs/promises';
import * as path from 'path';
import Handlebars from 'handlebars';
import { IEmailService } from '../interfaces/email.interface';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

type CompiledTemplates = {
    subject?: Handlebars.TemplateDelegate;
    html?: Handlebars.TemplateDelegate;
    text?: Handlebars.TemplateDelegate;
};

/**
 * AWS SES SMTP email sender using nodemailer.
 * - Reads SMTP config from env via ConfigService
 * - Supports templateKey + templateData (templates on disk at src/shared/templates/<key>/)
 * - Caches compiled templates in-memory
 * - Implements IEmailService so it can be swapped via DI
 */
@Injectable()
export class AwsSesService implements IEmailService {
    private readonly logger = new Logger(AwsSesService.name);
    private readonly transporter: nodemailer.Transporter;
    private readonly senderEmail: string;
    private readonly senderName: string;
    private readonly templateFolder: string;
    private readonly cache = new Map<string, CompiledTemplates>();

    constructor(private readonly configService: ConfigService) {
        // Resolve sender info (allow MAILCHIMP_* env keys as existing config)
        this.senderEmail = this.configService.get<string>('AWS_SES_FROM_EMAIL');
        this.senderName = this.configService.get<string>('AWS_SES_FROM_NAME');

        // Template folder (provider-agnostic templates on disk)
        this.templateFolder = path.resolve(__dirname, '..', 'templates');

        // SMTP settings for AWS SES (expected in env)
        const host = this.configService.get<string>('AWS_SES_SMTP_HOST');
        const port = Number(this.configService.get<number>('AWS_SES_SMTP_PORT'));
        const user =this.configService.get<string>('AWS_SES_USERNAME');
        const pass = this.configService.get<string>('AWS_SES_PASSWORD');

        if (!host || !user || !pass) {
            this.logger.warn(
                'AWS SES SMTP credentials are not fully configured. Email sending may fail. Ensure AWS_SES_SMTP_HOST, AWS_SES_USERNAME and AWS_SES_PASSWORD are set.',
            );
        }

        const credentials: SMTPTransport.Options = {
            host,
            port,
            secure: true,// port === 587,
            auth: {
                user,
                pass,
            },
            requireTLS: true,
            // tls: {
            //     ciphers: 'TLSv1.2:TLSv1.3',
            //     minVersion: 'TLSv1.2',
            //     // For debugging only: set rejectUnauthorized:false — don't use in production.
            // },
            connectionTimeout: 30_000,
        }

        this.logger.log("AWS SES Credentials: " + JSON.stringify(credentials));

        this.transporter = nodemailer.createTransport(credentials);

        // verify transporter availability (non-blocking)
        this.transporter.verify().then(
            () => this.logger.log('Email transporter (AWS SES) is ready'),
            (err) =>
                this.logger.warn('Email transporter (AWS SES) verification failed: ' + String(err)),
        );

        // register minimal helpers
        Handlebars.registerHelper('uppercase', (str: string) => String(str || '').toUpperCase());
    }

    /**
     * Send an email.
     * payload options:
     * - subject, html, text : direct overrides
     * - templateKey, templateData : load and render templates from disk
     */
    async send(to: string, payload: Record<string, any>): Promise<any> {
        try {
            let subject = payload.subject as string | undefined;
            let html = payload.html as string | undefined;
            let text = payload.text as string | undefined;

            if (payload.templateKey) {
                const rendered = await this.renderTemplate(payload.templateKey, payload.templateData || {});
                subject = subject || rendered.subject;
                html = html || rendered.html;
                text = text || rendered.text;
            }

            subject = subject;

            if (!html && !text) {
                text = `Notification: ${JSON.stringify(payload)}`;
            }

            const mailOptions: nodemailer.SendMailOptions = {
                from: `${this.senderName} <${this.senderEmail}>`,
                to,
                subject,
                text,
                html,
            };

            this.logger.log(`Sending email to ${to} using AWS SES (from ${this.senderEmail})`);

            const result = await this.transporter.sendMail(mailOptions);

            this.logger.log(`Email sent to ${to} (messageId=${(result as any).messageId ?? 'n/a'})`);
            return result;
        } catch (error) {
            this.logger.error('Failed to send email via AWS SES', {
                error: (error as Error).message,
                to,
                payloadPreview: { subject: payload.subject, templateKey: payload.templateKey },
            });
            throw error;
        }
    }

    private async renderTemplate(key: string, data: Record<string, any>): Promise<{ subject?: string; html?: string; text?: string }> {
        try {
            const compiled = await this.getCompiledTemplates(key);
            const out: { subject?: string; html?: string; text?: string } = {};

            if (compiled.subject) {
                out.subject = compiled.subject(data).replace(/\s+/g, ' ').trim();
            }
            if (compiled.html) {
                out.html = compiled.html(data);
            }
            if (compiled.text) {
                out.text = compiled.text(data);
            }

            return out;
        } catch (err) {
            this.logger.warn(`Template render failed for key=${key}: ${String(err)}`);
            return {};
        }
    }

    private async getCompiledTemplates(key: string): Promise<CompiledTemplates> {
        if (this.cache.has(key)) return this.cache.get(key)!;

        const folder = path.join(this.templateFolder, key);
        const compileIfExists = async (fileName: string) => {
            try {
                const p = path.join(folder, fileName);
                const source = await fs.readFile(p, 'utf8');
                return Handlebars.compile(source);
            } catch {
                return undefined;
            }
        };

        const compiled: CompiledTemplates = {
            subject: await compileIfExists('subject.hbs'),
            html: await compileIfExists('html.hbs'),
            text: await compileIfExists('text.hbs'),
        };

        this.cache.set(key, compiled);
        return compiled;
    }

    /**
     * Invalidate cached templates for a key (call after editing templates on disk)
     */
    invalidateTemplate(key: string) {
        this.cache.delete(key);
    }
}