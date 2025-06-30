import { Injectable } from '@nestjs/common';
import * as handlebars from 'handlebars';
import type { HelperDelegate, TemplateDelegate } from 'handlebars';

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
  }

  compile(template: string, options?: CompileOptions): TemplateDelegate {
    return this.hbs.compile(template, options);
  }

  registerHelper(name: string, fn: HelperDelegate): void {
    this.hbs.registerHelper(name, fn);
  }
}
