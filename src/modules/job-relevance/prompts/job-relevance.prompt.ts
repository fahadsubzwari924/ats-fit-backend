import { JOB_RELEVANCE_CONSTANTS } from '../constants/job-relevance.constants';
import { JobRelevanceDimensionLabel } from '../enums/job-relevance-dimension-label.enum';
import { JobRelevanceVerdict } from '../enums/job-relevance-verdict.enum';

const VERDICT_VALUES = Object.values(JobRelevanceVerdict);
const LABEL_VALUES = Object.values(JobRelevanceDimensionLabel);

export const RELEVANCE_TOOL = {
  name: JOB_RELEVANCE_CONSTANTS.LLM.TOOL_NAME,
  description:
    'Score how well a candidate profile matches a job description across tech stack, role type, and experience level.',
  input_schema: {
    type: 'object' as const,
    required: ['score', 'verdict', 'dimensions', 'gaps', 'strengths'],
    properties: {
      score: { type: 'integer', minimum: 0, maximum: 100 },
      verdict: { type: 'string', enum: VERDICT_VALUES },
      dimensions: {
        type: 'object',
        required: ['techStack', 'roleType', 'experienceLevel'],
        properties: {
          techStack: {
            type: 'object',
            required: ['score', 'label'],
            properties: {
              score: { type: 'integer', minimum: 0, maximum: 100 },
              label: { type: 'string', enum: LABEL_VALUES },
            },
          },
          roleType: {
            type: 'object',
            required: ['score', 'label'],
            properties: {
              score: { type: 'integer', minimum: 0, maximum: 100 },
              label: { type: 'string', enum: LABEL_VALUES },
            },
          },
          experienceLevel: {
            type: 'object',
            required: ['score', 'label'],
            properties: {
              score: { type: 'integer', minimum: 0, maximum: 100 },
              label: { type: 'string', enum: LABEL_VALUES },
            },
          },
        },
      },
      gaps: {
        type: 'array',
        maxItems: 4,
        items: { type: 'string', maxLength: 160 },
      },
      strengths: {
        type: 'array',
        maxItems: 3,
        items: { type: 'string', maxLength: 160 },
      },
    },
  },
};

export const RUBRIC_SYSTEM_BLOCK = `You are a job-fit analyst. Score how well a candidate's background matches a job description.

<scoring_rubric>
  Weights: techStack ${JOB_RELEVANCE_CONSTANTS.DIMENSION_WEIGHTS.TECH_STACK * 100}%, roleType ${JOB_RELEVANCE_CONSTANTS.DIMENSION_WEIGHTS.ROLE_TYPE * 100}%, experienceLevel ${JOB_RELEVANCE_CONSTANTS.DIMENSION_WEIGHTS.EXPERIENCE_LEVEL * 100}%.
  score = round(weighted sum).
  verdict: score <= ${JOB_RELEVANCE_CONSTANTS.THRESHOLDS.LOW_MAX} -> "${JobRelevanceVerdict.LOW}"; score <= ${JOB_RELEVANCE_CONSTANTS.THRESHOLDS.MEDIUM_MAX} -> "${JobRelevanceVerdict.MEDIUM}"; otherwise -> "${JobRelevanceVerdict.HIGH}".
  label per dimension: <${JOB_RELEVANCE_CONSTANTS.DIMENSION_LABEL_THRESHOLDS.MISMATCH_MAX + 1} ${JobRelevanceDimensionLabel.MISMATCH}, ${JOB_RELEVANCE_CONSTANTS.DIMENSION_LABEL_THRESHOLDS.MISMATCH_MAX + 1}-${JOB_RELEVANCE_CONSTANTS.DIMENSION_LABEL_THRESHOLDS.PARTIAL_MAX} ${JobRelevanceDimensionLabel.PARTIAL}, >${JOB_RELEVANCE_CONSTANTS.DIMENSION_LABEL_THRESHOLDS.PARTIAL_MAX} ${JobRelevanceDimensionLabel.ALIGNED}.

  Tech-stack scoring rules (apply strictly):
  - Identify the JD's mandatory technologies (programming languages, frameworks, cloud platforms, databases). Only what the JD explicitly requires — not preferred / "nice to have".
  - Compute coverage = (mandatory technologies the candidate demonstrably has) / (total mandatory technologies).
  - coverage = 0%        -> techStack score 5-15  (Mismatch)
  - coverage 1-30%       -> techStack score 16-30 (Mismatch)
  - coverage 31-60%      -> techStack score 31-55 (Partial)
  - coverage 61-85%      -> techStack score 56-75 (Partial/Aligned boundary)
  - coverage > 85%       -> techStack score 76-95 (Aligned)
  - Adjacent / transferable skills (e.g. Angular vs React, AWS vs Azure, Node.js vs .NET) are NOT counted as coverage. They may be mentioned in strengths but do not raise techStack score.

  Gaps requirements (apply strictly):
  - Enumerate EVERY mandatory technology the candidate is missing. Do not omit any.
  - Each gap must name the specific technology (e.g. "React.js", ".NET / ASP.NET Core", "Microsoft Azure"). No vague phrases like "modern frontend frameworks".
  - If techStack is Mismatch and gaps is empty, you have made an error — re-evaluate.
  - If 0% of mandatory tech overlaps, gaps MUST list at least the top 3 missing technologies.

  Strengths: name actual technologies and role aspects the candidate has that align with the JD. Do not pad with generic phrases.

  Output ONLY by calling the ${JOB_RELEVANCE_CONSTANTS.LLM.TOOL_NAME} tool.
</scoring_rubric>`;

export function buildCandidateProfileBlock(profileText: string): string {
  const truncated = profileText.slice(
    0,
    JOB_RELEVANCE_CONSTANTS.TRUNCATION.PROFILE_MAX_CHARS,
  );
  return `<candidate_profile>\n${truncated}\n</candidate_profile>`;
}

export function buildJobBlock(
  jobPosition: string,
  companyName: string,
  jobDescription: string,
): string {
  const jd = jobDescription.slice(
    0,
    JOB_RELEVANCE_CONSTANTS.TRUNCATION.JD_MAX_CHARS,
  );
  return `<position>${jobPosition}</position>
<company>${companyName}</company>
<job_description>
${jd}
</job_description>

Call ${JOB_RELEVANCE_CONSTANTS.LLM.TOOL_NAME} with your assessment.`;
}
