import { resumeTemplates } from '../../../shared/constants/resume.constants';

export function getTemplateS3Key(templateKey: string): string {
  return `${resumeTemplates.folder}/${templateKey}/template.html`;
}

export function getThumbnailS3Key(templateKey: string): string {
  return `${resumeTemplates.folder}/${templateKey}/thumbnail.png`;
}
