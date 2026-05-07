/**
 * Single source of truth for resume PDF filename generation.
 * Format: {CandidateName}_{JobPosition}.pdf
 * Example: Fahad_Sabzwari_Lead_Full_Stack_Engineer.pdf
 */
export function generateResumeFilename(
  candidateName: string,
  jobPosition: string,
): string {
  const sanitize = (s: string) =>
    (s ?? '')
      .trim()
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 60);

  const parts = [sanitize(candidateName), sanitize(jobPosition)].filter(Boolean);
  return parts.length ? `${parts.join('_')}.pdf` : 'Resume.pdf';
}
