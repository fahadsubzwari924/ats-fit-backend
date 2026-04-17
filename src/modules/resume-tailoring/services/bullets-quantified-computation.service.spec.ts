import {
  BulletsQuantifiedComputationService,
  BulletsQuantifiedResult,
} from './bullets-quantified-computation.service';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContent(
  experienceList: Array<{
    responsibilities?: string[];
    achievements?: string[];
  }>,
): TailoredContent {
  return {
    contactInfo: {
      name: 'Test User',
      email: 'test@example.com',
      phone: '555-0100',
      location: 'Remote',
    },
    summary: '',
    skills: {
      languages: [],
      frameworks: [],
      tools: [],
      databases: [],
      concepts: [],
    },
    experience: experienceList.map((e, i) => ({
      company: `Company ${i}`,
      position: `Role ${i}`,
      duration: '1 year',
      location: 'Remote',
      startDate: '2023-01',
      endDate: '2024-01',
      responsibilities: e.responsibilities ?? [],
      achievements: e.achievements ?? [],
    })),
    education: [],
    certifications: [],
    additionalSections: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BulletsQuantifiedComputationService', () => {
  let service: BulletsQuantifiedComputationService;

  beforeEach(() => {
    service = new BulletsQuantifiedComputationService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('computeQuantified', () => {
    it('counts bullets with plain numbers correctly', () => {
      const before = makeContent([
        {
          responsibilities: [
            'Led a team of 5 engineers',
            'Reviewed code daily',
          ],
        },
      ]);
      const after = makeContent([
        {
          responsibilities: [
            'Led a team of 5 engineers',
            'Reviewed code 3 times per sprint',
            'Shipped features on time',
          ],
        },
      ]);

      const result: BulletsQuantifiedResult = service.computeQuantified(
        before,
        after,
      );

      expect(result.before).toBe(1); // "5 engineers"
      expect(result.after).toBe(2); // "5 engineers", "3 times"
      expect(result.total).toBe(3);
    });

    it('returns { before: 2, after: 7, total: N } for the specified scenario', () => {
      const beforeResponsibilities = [
        'Increased revenue by 20%', // quantified
        'Managed team of 10 people', // quantified
        'Led cross-functional meetings', // not quantified
        'Prepared reports', // not quantified
      ];

      const afterResponsibilities = [
        'Grew revenue by 35% YoY', // quantified
        'Scaled team from 10 to 25 engineers', // quantified
        'Reduced build time by 50%', // quantified
        'Shipped 12 features per quarter', // quantified
        'Cut AWS costs by $15,000 monthly', // quantified (dollar)
        'Improved deployment frequency 3x', // quantified
        'Managed cross-functional meetings', // not quantified
        'Increased NPS by 18 points', // quantified
        'Wrote documentation', // not quantified
      ];

      const before = makeContent([
        { responsibilities: beforeResponsibilities },
      ]);
      const after = makeContent([{ responsibilities: afterResponsibilities }]);

      const result = service.computeQuantified(before, after);

      expect(result.before).toBe(2);
      expect(result.after).toBe(7);
      expect(result.total).toBe(9);
    });

    it('returns { before: 0, after: 0, total: 0 } when there are no bullets', () => {
      const empty = makeContent([]);

      const result = service.computeQuantified(empty, empty);

      expect(result).toEqual({ before: 0, after: 0, total: 0 });
    });

    it('matches dollar amounts like $50,000', () => {
      const before = makeContent([{ responsibilities: ['Managed a budget'] }]);
      const after = makeContent([
        { responsibilities: ['Managed a budget of $50,000 annually'] },
      ]);

      const result = service.computeQuantified(before, after);

      expect(result.before).toBe(0);
      expect(result.after).toBe(1);
    });

    it('matches percentages like 25%', () => {
      const before = makeContent([
        { responsibilities: ['Improved efficiency'] },
      ]);
      const after = makeContent([
        { responsibilities: ['Improved efficiency by 25%'] },
      ]);

      const result = service.computeQuantified(before, after);

      expect(result.before).toBe(0);
      expect(result.after).toBe(1);
    });

    it('counts achievements in addition to responsibilities', () => {
      const content = makeContent([
        {
          responsibilities: ['Led team'],
          achievements: ['Awarded best employee 2 years in a row'],
        },
      ]);

      const result = service.computeQuantified(content, content);

      // "2 years" matches the pattern in achievements
      expect(result.after).toBe(1);
      expect(result.total).toBe(2); // 1 responsibility + 1 achievement
    });

    it('handles missing responsibilities or achievements gracefully', () => {
      // makeContent always provides both arrays, but test with empty arrays
      const before = makeContent([{ responsibilities: [], achievements: [] }]);
      const after = makeContent([{ responsibilities: [], achievements: [] }]);

      expect(() => service.computeQuantified(before, after)).not.toThrow();
      expect(service.computeQuantified(before, after)).toEqual({
        before: 0,
        after: 0,
        total: 0,
      });
    });

    it('matches multiplier patterns like 3x or 5k', () => {
      const before = makeContent([{ responsibilities: ['Improved speed'] }]);
      const after = makeContent([
        {
          responsibilities: [
            'Improved speed 3x over baseline',
            'Processed 50k records daily',
          ],
        },
      ]);

      const result = service.computeQuantified(before, after);

      expect(result.before).toBe(0);
      expect(result.after).toBe(2);
    });

    it('uses total bullet count from after content, not before', () => {
      const before = makeContent([
        {
          responsibilities: ['Task A', 'Task B', 'Task C with 5 items'],
        },
      ]);
      const after = makeContent([
        {
          responsibilities: ['Expanded Task A to cover 10 regions', 'Task B'],
        },
      ]);

      const result = service.computeQuantified(before, after);

      expect(result.total).toBe(2); // after has 2 bullets
      expect(result.before).toBe(1); // "5 items"
      expect(result.after).toBe(1); // "10 regions"
    });
  });
});
