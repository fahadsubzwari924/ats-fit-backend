/**
 * Display-facing dimension label values.
 * Title Case is intentional — values are used verbatim in the LLM scoring
 * rubric prompt and returned as-is in the API response for frontend display.
 * Do NOT lowercase these values.
 */
export enum JobRelevanceDimensionLabel {
  MISMATCH = 'Mismatch',
  PARTIAL = 'Partial',
  ALIGNED = 'Aligned',
}
