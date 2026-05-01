export type JobApplicationAttachmentKind =
  | 'job_description_snapshot'
  | 'offer_letter'
  | 'take_home_brief'
  | 'prep_notes'
  | 'cover_letter_pdf'
  | 'other';

export interface IJobApplicationAttachment {
  kind: JobApplicationAttachmentKind;
  label: string;
  url: string;
  uploaded_at: string;
}
