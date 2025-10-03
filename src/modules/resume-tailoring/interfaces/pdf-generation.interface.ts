/**
 * PDF generation metadata
 *
 * Technical information about the generated PDF document.
 */
export interface PdfGenerationMetadata {
  pdfSizeBytes: number;
  pageCount: number;
  templateUsed: string;
  generationTimeMs: number;
  compressionRatio?: number;
  fontEmbedded: boolean;
}

/**
 * Template rendering options
 *
 * Configuration options for PDF template rendering.
 */
export interface TemplateRenderingOptions {
  fontSize?: number;
  fontFamily?: string;
  margins?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  colorScheme?: 'default' | 'professional' | 'modern';
  includeLogo?: boolean;
}

/**
 * PDF generation result
 *
 * Contains the generated PDF content and associated metadata.
 */
export interface PdfGenerationResult {
  pdfContent: string; // base64 encoded PDF
  filename: string;
  generationMetadata: PdfGenerationMetadata;
  templateInfo: {
    templateId: string;
    templateName: string;
    version: string;
  };
}
