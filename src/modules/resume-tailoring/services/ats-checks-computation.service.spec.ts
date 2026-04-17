import { AtsChecksComputationService } from './ats-checks-computation.service';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';

describe('AtsChecksComputationService', () => {
  let service: AtsChecksComputationService;

  /** A fully valid TailoredContent that should pass all 10 checks. */
  const validContent: TailoredContent = {
    contactInfo: {
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+1-555-000-1234',
      location: 'New York, NY',
    },
    summary:
      'Experienced software engineer with 8 years building scalable systems.',
    skills: {
      languages: ['TypeScript', 'Python'],
      frameworks: ['NestJS'],
      tools: [],
      databases: ['PostgreSQL'],
      concepts: [],
    },
    experience: [
      {
        company: 'Acme Corp',
        position: 'Senior Engineer',
        duration: '3 years',
        location: 'Remote',
        startDate: '2021-01',
        endDate: '2024-01',
        responsibilities: [
          'Designed microservices that reduced latency by 40%.',
          'Led a team of five engineers to deliver the v2 platform.',
          'Implemented CI/CD pipelines using GitHub Actions.',
        ],
        achievements: [],
      },
    ],
    education: [
      {
        institution: 'State University',
        degree: 'B.S.',
        major: 'Computer Science',
        startDate: '2013-09',
        endDate: '2017-05',
      },
    ],
    certifications: [],
    additionalSections: [],
  };

  beforeEach(() => {
    service = new AtsChecksComputationService();
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it('returns passed=10 and no failures for complete valid content', () => {
    const result = service.computeChecks(validContent);

    expect(result.total).toBe(10);
    expect(result.passed).toBe(10);
    expect(result.failures).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Contact info checks
  // ---------------------------------------------------------------------------

  it('reports failure and passed=9 when email is missing', () => {
    const content: TailoredContent = {
      ...validContent,
      contactInfo: { ...validContent.contactInfo, email: '' },
    };

    const result = service.computeChecks(content);

    expect(result.passed).toBe(9);
    expect(result.total).toBe(10);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/email/i);
  });

  it('reports failure when phone is missing', () => {
    const content: TailoredContent = {
      ...validContent,
      contactInfo: { ...validContent.contactInfo, phone: '   ' },
    };

    const result = service.computeChecks(content);

    expect(result.passed).toBe(9);
    expect(result.failures.some((f) => /phone/i.test(f))).toBe(true);
  });

  it('reports failure when name is missing', () => {
    const content: TailoredContent = {
      ...validContent,
      contactInfo: { ...validContent.contactInfo, name: '' },
    };

    const result = service.computeChecks(content);

    expect(result.passed).toBe(9);
    expect(result.failures.some((f) => /name/i.test(f))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Summary check
  // ---------------------------------------------------------------------------

  it('reports failure and passed=9 when summary is empty', () => {
    const content: TailoredContent = { ...validContent, summary: '   ' };

    const result = service.computeChecks(content);

    expect(result.passed).toBe(9);
    expect(result.failures.some((f) => /summary/i.test(f))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Skills check
  // ---------------------------------------------------------------------------

  it('reports failure when all skill categories are empty', () => {
    const content: TailoredContent = {
      ...validContent,
      skills: {
        languages: [],
        frameworks: [],
        tools: [],
        databases: [],
        concepts: [],
      },
    };

    const result = service.computeChecks(content);

    expect(result.passed).toBe(9);
    expect(result.failures.some((f) => /skill/i.test(f))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Experience checks
  // ---------------------------------------------------------------------------

  it('reports failure and passed=9 when experience array is empty', () => {
    const content: TailoredContent = { ...validContent, experience: [] };

    const result = service.computeChecks(content);

    expect(result.passed).toBe(9);
    expect(result.failures.some((f) => /experience/i.test(f))).toBe(true);
  });

  it('reports failure when an experience entry has no startDate', () => {
    const content: TailoredContent = {
      ...validContent,
      experience: [{ ...validContent.experience[0], startDate: '' }],
    };

    const result = service.computeChecks(content);

    expect(result.passed).toBe(9);
    expect(result.failures.some((f) => /start date/i.test(f))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Education check
  // ---------------------------------------------------------------------------

  it('reports failure when education array is empty', () => {
    const content: TailoredContent = { ...validContent, education: [] };

    const result = service.computeChecks(content);

    expect(result.passed).toBe(9);
    expect(result.failures.some((f) => /education/i.test(f))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Bullet quality checks
  // ---------------------------------------------------------------------------

  it('reports failure when fewer than 80% of bullets start with a capital letter', () => {
    const content: TailoredContent = {
      ...validContent,
      experience: [
        {
          ...validContent.experience[0],
          responsibilities: [
            'Good bullet starting with capital.',
            'another bullet starting lowercase.',
            'yet another lowercase bullet.',
          ],
        },
      ],
    };

    const result = service.computeChecks(content);

    expect(result.passed).toBe(9);
    expect(result.failures.some((f) => /capital/i.test(f))).toBe(true);
  });

  it('passes check 9 when exactly 80% of bullets start with a capital letter', () => {
    const content: TailoredContent = {
      ...validContent,
      experience: [
        {
          ...validContent.experience[0],
          responsibilities: [
            'Capital bullet one.',
            'Capital bullet two.',
            'Capital bullet three.',
            'Capital bullet four.',
            'lowercase bullet five.',
          ],
        },
      ],
    };

    const result = service.computeChecks(content);

    // 4 out of 5 = 80% — should pass
    expect(result.failures.some((f) => /capital/i.test(f))).toBe(false);
  });

  it('reports failure when a bullet is empty or whitespace-only', () => {
    // 4 out of 5 bullets start with a capital (80% threshold met),
    // but one bullet is whitespace-only — only check 10 should fire.
    const content: TailoredContent = {
      ...validContent,
      experience: [
        {
          ...validContent.experience[0],
          responsibilities: [
            'Valid bullet one.',
            'Valid bullet two.',
            'Valid bullet three.',
            'Valid bullet four.',
            '   ',
          ],
        },
      ],
    };

    const result = service.computeChecks(content);

    expect(result.passed).toBe(9);
    expect(result.failures).toHaveLength(1);
    expect(result.failures.some((f) => /empty/i.test(f))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Multiple simultaneous failures
  // ---------------------------------------------------------------------------

  it('accumulates multiple failures and adjusts passed count accordingly', () => {
    const content: TailoredContent = {
      ...validContent,
      contactInfo: { ...validContent.contactInfo, email: '', phone: '' },
      summary: '',
    };

    const result = service.computeChecks(content);

    expect(result.total).toBe(10);
    expect(result.passed).toBe(7);
    expect(result.failures).toHaveLength(3);
  });
});
