export const VERB_TIERS = `<verb_tiers>
Choose action verbs appropriate to the candidate's seniority level:

L3–L4 (Junior/Mid IC): Built, Implemented, Developed, Configured, Fixed, Wrote, Added, Tested, Documented, Supported
L4–L5 (Senior IC): Designed, Refactored, Optimized, Automated, Reduced, Improved, Shipped, Debugged, Reviewed, Integrated
L5–L6 (Staff/Principal): Architected, Led, Established, Defined, Drove, Standardized, Mentored, Proposed, Evaluated, Consolidated
L6–L7 (Staff+/Management): Spearheaded, Transformed, Scaled, Founded, Grew, Championed, Oversaw, Directed, Strategized, Launched

Default to L4–L5 verbs unless the resume clearly signals higher seniority. All verbs must be past-tense for past roles; present-tense for current role responsibilities.
</verb_tiers>`;

export const BANNED_PHRASES = `<banned_phrases>
Never use these phrases or close variants:
passionate, results-driven, team player, hard-working, detail-oriented, go-getter, synergy, leverage (as verb), proven track record, dynamic, rockstar, ninja, guru, thought leader, game-changer, innovative, self-starter, proactive, highly motivated, strong communicator, excellent interpersonal skills
</banned_phrases>`;
