import { Injectable } from '@nestjs/common';
import * as handlebars from 'handlebars';
import type { HelperDelegate, TemplateDelegate } from 'handlebars';

import type { ContactLineFields } from '../interfaces/contact-line-fields.interface';

// Define a type-safe Handlebars interface
interface HandlebarsInstance {
  compile: (template: string, options?: CompileOptions) => TemplateDelegate;
  registerHelper: (name: string, fn: HelperDelegate) => void;
}

@Injectable()
export class HandlebarsService {
  private readonly hbs: HandlebarsInstance;

  constructor() {
    // Initialize Handlebars instance
    this.hbs = handlebars.create();
    this.registerHelpers();
  }

  compile(template: string, options?: CompileOptions): TemplateDelegate {
    return this.hbs.compile(template, options);
  }

  registerHelper(name: string, fn: HelperDelegate): void {
    this.hbs.registerHelper(name, fn);
  }

  private registerHelpers(): void {
    this.hbs.registerHelper('join', (arr: unknown, separator: string) => {
      if (!Array.isArray(arr) || arr.length === 0) return '';
      return arr.join(typeof separator === 'string' ? separator : ', ');
    });

    this.hbs.registerHelper('json', (context: unknown) => {
      return JSON.stringify(context);
    });

    this.hbs.registerHelper('contactLine', (contactInfo: unknown) => {
      const c: ContactLineFields =
        contactInfo !== null &&
        typeof contactInfo === 'object' &&
        !Array.isArray(contactInfo)
          ? (contactInfo as ContactLineFields)
          : {};
      const parts: string[] = [];
      const push = (val: string | undefined, html?: string) => {
        if (val && String(val).trim().length > 0) {
          parts.push(html ?? val);
        }
      };
      push(c.email);
      push(c.phone);
      push(c.location);
      push(c.linkedin, `<a href="${c.linkedin}" target="_blank">LinkedIn</a>`);
      push(c.github, `<a href="${c.github}" target="_blank">GitHub</a>`);
      return new handlebars.SafeString(parts.join(' | '));
    });
  }
}
