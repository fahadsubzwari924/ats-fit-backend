export interface IReplaceResumeContext {
  userId: string;
  file: Express.Multer.File;
  idempotencyKey?: string;
}

export interface IReplaceResumeResult {
  newResumeId: string;
  newProcessingId: string;
  archivedExtractId: string;
  archivedAt: Date;
}
