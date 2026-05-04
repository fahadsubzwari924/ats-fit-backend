/**
 * Golden-set evaluation harness for prompt integrity validation.
 *
 * Runs standalone via ts-node — does NOT bootstrap NestJS.
 * Usage: npx ts-node scripts/test-prompts.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Inline PromptService to avoid NestJS DI bootstrap entirely.
// We only need getJobDescriptionAnalysisPrompt for prompt-construction tests.
// ---------------------------------------------------------------------------
import { PromptService } from '../src/shared/services/prompt.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResumeExperience {
  company: string;
  position: string;
  startDate: string;
  endDate: string;
  responsibilities: string[];
  achievements: string[];
}

interface ResumeFixture {
  title: string;
  contactInfo: { name: string; email: string; location: string };
  summary: string;
  skills: {
    languages: string[];
    frameworks: string[];
    tools: string[];
  };
  experience: ResumeExperience[];
  education: Array<{
    institution: string;
    degree: string;
    startDate: string;
    endDate: string;
  }>;
  certifications: unknown[];
}

interface JdFixture {
  jobPosition: string;
  companyName: string;
  jobDescription: string;
}

interface ExpectedOutput {
  minBulletsPerExperience: number[];
  mustContainKeywords: string[];
  bannedPhrases: string[];
  noInventedMetrics: boolean;
  summaryMaxSentences: number;
}

interface FixtureScores {
  bulletCountParityValid: boolean;
  keywordCoverageValid: boolean;
  hallucinationHeuristicValid: boolean;
  bannedPhraseScanPass: boolean;
}

interface FixtureResult {
  name: string;
  promptBuilt: boolean;
  scores: FixtureScores;
  issues: string[];
}

interface Report {
  timestamp: string;
  fixtures: FixtureResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

// ---------------------------------------------------------------------------
// Score helpers
// ---------------------------------------------------------------------------

/**
 * bullet-count parity: minBulletsPerExperience must have one entry per
 * experience entry in resume.json, and each entry's value must be <= the
 * actual responsibility count in that experience.
 */
function scoreBulletCountParity(
  resume: ResumeFixture,
  expected: ExpectedOutput,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (expected.minBulletsPerExperience.length !== resume.experience.length) {
    issues.push(
      `minBulletsPerExperience has ${expected.minBulletsPerExperience.length} entries but resume has ${resume.experience.length} experience(s)`,
    );
    return { valid: false, issues };
  }

  resume.experience.forEach((exp, i) => {
    const minRequired = expected.minBulletsPerExperience[i];
    const actual = exp.responsibilities.length;
    if (actual < minRequired) {
      issues.push(
        `Experience[${i}] (${exp.company}) has ${actual} bullet(s) but minBulletsPerExperience[${i}] requires ${minRequired}`,
      );
    }
  });

  return { valid: issues.length === 0, issues };
}

/**
 * keyword coverage: every keyword in mustContainKeywords must appear in the
 * JD text (case-insensitive). This is a fixture integrity check — the keywords
 * should be derivable from the JD we wrote.
 */
function scoreKeywordCoverage(
  jd: JdFixture,
  expected: ExpectedOutput,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const haystack =
    `${jd.jobDescription} ${jd.jobPosition} ${jd.companyName}`.toLowerCase();

  for (const kw of expected.mustContainKeywords) {
    if (!haystack.includes(kw.toLowerCase())) {
      issues.push(
        `mustContainKeyword "${kw}" not found in JD text — fixture integrity error`,
      );
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * hallucination heuristic: if noInventedMetrics is true, the source resume
 * bullets should contain at least one numeric token (otherwise there is no
 * metric to invent or preserve, making the flag meaningless).
 * If noInventedMetrics is false, we skip this check.
 */
function scoreHallucinationHeuristic(
  resume: ResumeFixture,
  expected: ExpectedOutput,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!expected.noInventedMetrics) {
    // Flag is off — nothing to validate
    return { valid: true, issues };
  }

  const allBullets = resume.experience.flatMap((e) => e.responsibilities);
  const allText = allBullets.join(' ');
  // Match standalone numbers, percentages, dollar amounts, or ordinals
  const numericPattern = /\b\d+[\d,]*(\.\d+)?(%|\$|k|M|B)?\b/i;
  const hasNumericToken = numericPattern.test(allText);

  if (!hasNumericToken) {
    issues.push(
      'noInventedMetrics is true but source resume responsibilities contain no numeric tokens — the flag is not meaningful for this fixture',
    );
  }

  return { valid: issues.length === 0, issues };
}

/**
 * banned-phrase scan: none of the banned phrases should appear in the resume
 * summary. The source content should already be free of filler language.
 */
function scoreBannedPhraseScan(
  resume: ResumeFixture,
  expected: ExpectedOutput,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const summaryLower = resume.summary.toLowerCase();

  for (const phrase of expected.bannedPhrases) {
    if (summaryLower.includes(phrase.toLowerCase())) {
      issues.push(
        `Banned phrase "${phrase}" found in resume summary — fixture should not contain filler language`,
      );
    }
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Main harness
// ---------------------------------------------------------------------------

function loadJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function evaluateFixture(
  fixtureDir: string,
  name: string,
  promptService: PromptService,
): FixtureResult {
  const issues: string[] = [];

  const resume = loadJson<ResumeFixture>(path.join(fixtureDir, 'resume.json'));
  const jd = loadJson<JdFixture>(path.join(fixtureDir, 'jd.json'));
  const expected = loadJson<ExpectedOutput>(
    path.join(fixtureDir, 'expected_output.json'),
  );

  // Step 1: Build the prompt (construction-only, no LLM call)
  let promptBuilt = false;
  try {
    const builtPrompt = promptService.getJobDescriptionAnalysisPrompt(
      jd.jobDescription,
      jd.jobPosition,
      jd.companyName,
    );
    promptBuilt = typeof builtPrompt === 'string' && builtPrompt.length > 0;
    if (!promptBuilt) {
      issues.push('getJobDescriptionAnalysisPrompt returned an empty string');
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    issues.push(`Prompt construction threw: ${message}`);
  }

  // Step 2: Run static scoring checks
  const bulletResult = scoreBulletCountParity(resume, expected);
  const keywordResult = scoreKeywordCoverage(jd, expected);
  const hallucinationResult = scoreHallucinationHeuristic(resume, expected);
  const bannedPhraseResult = scoreBannedPhraseScan(resume, expected);

  issues.push(...bulletResult.issues);
  issues.push(...keywordResult.issues);
  issues.push(...hallucinationResult.issues);
  issues.push(...bannedPhraseResult.issues);

  return {
    name,
    promptBuilt,
    scores: {
      bulletCountParityValid: bulletResult.valid,
      keywordCoverageValid: keywordResult.valid,
      hallucinationHeuristicValid: hallucinationResult.valid,
      bannedPhraseScanPass: bannedPhraseResult.valid,
    },
    issues,
  };
}

function run(): void {
  const goldenDir = path.resolve(
    __dirname,
    '../test/prompts/golden',
  );

  const fixtureDirs = fs
    .readdirSync(goldenDir)
    .filter((entry) =>
      fs.statSync(path.join(goldenDir, entry)).isDirectory(),
    )
    .sort();

  const promptService = new PromptService();
  const fixtureResults: FixtureResult[] = [];

  for (const name of fixtureDirs) {
    const fixtureDir = path.join(goldenDir, name);
    const result = evaluateFixture(fixtureDir, name, promptService);
    fixtureResults.push(result);
  }

  const passed = fixtureResults.filter(
    (r) =>
      r.promptBuilt &&
      r.scores.bulletCountParityValid &&
      r.scores.keywordCoverageValid &&
      r.scores.hallucinationHeuristicValid &&
      r.scores.bannedPhraseScanPass,
  ).length;

  const report: Report = {
    timestamp: new Date().toISOString(),
    fixtures: fixtureResults,
    summary: {
      total: fixtureResults.length,
      passed,
      failed: fixtureResults.length - passed,
    },
  };

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');

  if (report.summary.failed > 0) {
    process.exit(1);
  }
}

run();
