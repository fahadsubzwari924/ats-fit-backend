import { IReplacementQuota } from '../interfaces/replacement-quota.interface';

export class ReplaceResumeResponseDto {
  status!: 'queued';
  newResumeId!: string;
  newProcessingId!: string;
  archivedExtractId!: string;
  archivedAt!: Date;
  quota!: IReplacementQuota;
}
