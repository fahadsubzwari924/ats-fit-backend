import { Injectable, Logger } from '@nestjs/common';
import { PdfGenerationService } from './pdf-generation.service';
import { CoverLetterResult } from '../interfaces/cover-letter.interface';

/**
 * Single-purpose service that converts a structured CoverLetterResult into a
 * print-ready PDF.
 *
 * Responsibilities (SRP):
 *   1. Render a CoverLetterResult to clean, semantic HTML.
 *   2. Hand that HTML to PdfGenerationService (reusing the Puppeteer pool
 *      that already powers tailored-resume PDFs — same engine, same fonts,
 *      same byte-stable output).
 *   3. Derive a deterministic filename in the project-wide
 *      {CandidateName}_{JobPosition}_Cover_Letter.pdf format.
 *
 * It does NOT generate cover-letter content (that's CoverLetterGenerationService),
 * fetch it from DB, or apply rate-limits — those live one layer up in the controller.
 */
@Injectable()
export class CoverLetterPdfService {
  private readonly logger = new Logger(CoverLetterPdfService.name);

  constructor(private readonly pdfGenerationService: PdfGenerationService) {}

  public async renderPdf(input: {
    coverLetter: CoverLetterResult;
    jobPosition?: string | null;
    companyName?: string | null;
  }): Promise<{ buffer: Buffer; filename: string }> {
    const html = this.renderHtml(input.coverLetter, input.companyName ?? '');
    const result = await this.pdfGenerationService.generatePdfFromHtml(html, {
      optimizationMode: 'standard',
    });

    const filename = this.buildFilename(
      input.coverLetter.coverLetter?.candidateName ?? '',
      input.jobPosition ?? '',
    );

    this.logger.log(
      `Cover letter PDF rendered in ${result.metadata.totalTimeMs}ms (${filename})`,
    );

    return { buffer: Buffer.from(result.buffer), filename };
  }

  private renderHtml(result: CoverLetterResult, companyName: string): string {
    const cl = result.coverLetter;
    const safe = (value: string | undefined | null): string =>
      this.escapeHtml(value ?? '');

    const bodyParagraphs = (cl?.body ?? [])
      .map((p) => `<p>${safe(p)}</p>`)
      .join('\n');

    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Cover Letter</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: 'Georgia', 'Times New Roman', serif;
    color: #1f2937;
    background: #ffffff;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 22mm 24mm;
    background: #ffffff;
  }
  .meta {
    color: #6b7280;
    font-size: 11pt;
    margin-bottom: 18pt;
  }
  .recipient {
    margin-bottom: 14pt;
    font-size: 11.5pt;
  }
  .recipient strong {
    color: #111827;
  }
  .letter {
    font-size: 11.5pt;
    line-height: 1.65;
  }
  .letter p {
    margin: 0 0 11pt 0;
  }
  .greeting {
    font-weight: 600;
    color: #111827;
    margin-bottom: 14pt;
  }
  .signoff {
    margin-top: 22pt;
  }
  .signature-name {
    margin-top: 26pt;
    font-weight: 700;
    color: #111827;
    font-size: 12pt;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="meta">${safe(today)}</div>
    ${
      companyName
        ? `<div class="recipient"><strong>${safe(companyName)}</strong></div>`
        : ''
    }
    <div class="letter">
      ${cl?.greeting ? `<p class="greeting">${safe(cl.greeting)}</p>` : ''}
      ${cl?.opening ? `<p>${safe(cl.opening)}</p>` : ''}
      ${bodyParagraphs}
      ${cl?.closing ? `<p>${safe(cl.closing)}</p>` : ''}
      ${cl?.signoff ? `<p class="signoff">${safe(cl.signoff)}</p>` : ''}
      ${
        cl?.candidateName
          ? `<p class="signature-name">${safe(cl.candidateName)}</p>`
          : ''
      }
    </div>
  </div>
</body>
</html>`;
  }

  private buildFilename(candidateName: string, jobPosition: string): string {
    const sanitize = (s: string): string =>
      (s ?? '')
        .trim()
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 60);

    const parts = [
      sanitize(candidateName),
      sanitize(jobPosition),
      'Cover_Letter',
    ].filter(Boolean);
    return parts.length > 1 ? `${parts.join('_')}.pdf` : 'Cover_Letter.pdf';
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
