import { IsUUID } from 'class-validator';

export class RestoreArchivedResumeDto {
  @IsUUID()
  archivedExtractId!: string;
}
