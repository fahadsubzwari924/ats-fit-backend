import { JOB_RELEVANCE_CONSTANTS } from '../constants/job-relevance.constants';
import { JobRelevanceDimensionLabel } from '../enums/job-relevance-dimension-label.enum';
import { JobRelevanceVerdict } from '../enums/job-relevance-verdict.enum';

const VERDICT_VALUES = Object.values(JobRelevanceVerdict);
const LABEL_VALUES = Object.values(JobRelevanceDimensionLabel);

export const RELEVANCE_TOOL = {
  name: JOB_RELEVANCE_CONSTANTS.LLM.TOOL_NAME,
  description:
    'Score how well a candidate profile matches a job description across tech stack, role type, and experience level. Must enumerate every mandatory technology from the JD in `mandatoryTechs` before scoring.',
  input_schema: {
    type: 'object' as const,
    // `mandatoryTechs` is required FIRST so the model performs enumeration
    // before judging — empty `gaps` cases used to slip through because the
    // model could jump straight to scoring. Server derives `gaps` from this
    // list (filter where `presentInProfile === false`), so the schema does
    // NOT include a `gaps` field — there's nothing for the model to skip.
    required: ['mandatoryTechs', 'score', 'verdict', 'dimensions', 'strengths'],
    properties: {
      mandatoryTechs: {
        type: 'array',
        description:
          'Every mandatory technology the JD explicitly requires (programming languages, frameworks, cloud platforms, databases, infra). Exclude preferred / "nice to have". For each, mark whether it is demonstrably present in the candidate profile.',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          required: ['name', 'presentInProfile'],
          properties: {
            name: { type: 'string', maxLength: 60 },
            presentInProfile: { type: 'boolean' },
            evidence: {
              type: 'string',
              maxLength: 120,
              description:
                'Brief rationale. If present: where in the profile (project / role / years). If missing: one phrase on why no profile signal counts. Keep terse.',
            },
          },
        },
      },
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
      strengths: {
        type: 'array',
        maxItems: 3,
        items: { type: 'string', maxLength: 160 },
      },
    },
  },
};

export const RUBRIC_SYSTEM_BLOCK = `You are a job-fit analyst. Score how well a candidate's background matches a job description.

<process>
  Follow these steps IN ORDER. Do not skip ahead.

  Step 1 — Extract mandatory technologies from the JD.
    Read the job description and list every technology the JD EXPLICITLY requires:
    programming languages, frameworks, cloud platforms, databases, infrastructure.
    Exclude "nice to have", "bonus", or "preferred" items.
    At minimum, every real JD has 1 mandatory technology — if you find none, you
    are reading the JD wrong.

  Step 2 — For EACH mandatory technology, decide presence.
    presentInProfile = true ONLY IF the candidate profile demonstrably mentions
    this exact technology (or a direct match in the same vendor / product family,
    e.g. "Postgres" satisfies "PostgreSQL"). Adjacent / transferable skills do
    NOT count — Angular does not satisfy React; AWS does not satisfy Azure;
    Node.js does not satisfy .NET; SQL Server does not satisfy MySQL.
    If the JD says ".NET / ASP.NET Core" and the profile shows Node.js only,
    presentInProfile is FALSE for that tech.

    Provide a short \`evidence\` string for each entry:
    - if present: where in the profile (project / role / years of experience)
    - if missing: one phrase explaining why no profile signal qualifies

  Step 3 — Compute techStack score from coverage.
    coverage = (count where presentInProfile=true) / (total mandatoryTechs).
    Map coverage to score:
      coverage = 0%        -> techStack score 5-15  (Mismatch)
      coverage 1-30%       -> techStack score 16-30 (Mismatch)
      coverage 31-60%      -> techStack score 31-55 (Partial)
      coverage 61-85%      -> techStack score 56-75 (Partial / Aligned boundary)
      coverage > 85%       -> techStack score 76-95 (Aligned)
      coverage = 100%      -> techStack score 96-100 (Aligned)

  Step 4 — Score roleType and experienceLevel.
    label per dimension: <${JOB_RELEVANCE_CONSTANTS.DIMENSION_LABEL_THRESHOLDS.MISMATCH_MAX + 1} ${JobRelevanceDimensionLabel.MISMATCH}, ${JOB_RELEVANCE_CONSTANTS.DIMENSION_LABEL_THRESHOLDS.MISMATCH_MAX + 1}-${JOB_RELEVANCE_CONSTANTS.DIMENSION_LABEL_THRESHOLDS.PARTIAL_MAX} ${JobRelevanceDimensionLabel.PARTIAL}, >${JOB_RELEVANCE_CONSTANTS.DIMENSION_LABEL_THRESHOLDS.PARTIAL_MAX} ${JobRelevanceDimensionLabel.ALIGNED}.

  Step 5 — Composite score and verdict.
    Weights: techStack ${JOB_RELEVANCE_CONSTANTS.DIMENSION_WEIGHTS.TECH_STACK * 100}%, roleType ${JOB_RELEVANCE_CONSTANTS.DIMENSION_WEIGHTS.ROLE_TYPE * 100}%, experienceLevel ${JOB_RELEVANCE_CONSTANTS.DIMENSION_WEIGHTS.EXPERIENCE_LEVEL * 100}%.
    score = round(weighted sum).
    verdict: score <= ${JOB_RELEVANCE_CONSTANTS.THRESHOLDS.LOW_MAX} -> "${JobRelevanceVerdict.LOW}"; score <= ${JOB_RELEVANCE_CONSTANTS.THRESHOLDS.MEDIUM_MAX} -> "${JobRelevanceVerdict.MEDIUM}"; otherwise -> "${JobRelevanceVerdict.HIGH}".

  Step 6 — Strengths.
    Up to 3 entries naming the specific technologies and role aspects the
    candidate has that align with the JD. Do not pad with generic phrases.
</process>

<important>
  - DO NOT output a \`gaps\` field. The server derives \`gaps\` authoritatively
    from \`mandatoryTechs\` (entries where \`presentInProfile === false\`).
    Your job is to be honest and complete in \`mandatoryTechs\`.
  - DO NOT mark presentInProfile=true to be polite or because the candidate
    looks "close enough". The schema requires honest enumeration.
  - DO NOT skip a mandatory tech because it feels minor. List every one the
    JD requires; trust the schema's maxItems cap.

  Output ONLY by calling the ${JOB_RELEVANCE_CONSTANTS.LLM.TOOL_NAME} tool.
</important>`;

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
