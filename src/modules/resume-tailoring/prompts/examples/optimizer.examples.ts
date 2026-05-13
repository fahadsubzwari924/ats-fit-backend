export const OPTIMIZER_EXAMPLES = `<examples>

<example id="1" case="strong-quantified-fact">
Input bullet: "Improved API response time"
User-verified fact: "Reduced p99 latency from 820ms to 140ms by introducing Redis caching"
Output bullet: "Reduced API p99 latency from 820ms to 140ms by introducing a Redis caching layer, improving user-facing response time by 83%."
Note: Metric came directly from user-verified fact — not invented.
</example>

<example id="2" case="vague-answer">
Input bullet: "Worked on CI/CD improvements"
User-verified fact: "Made deploys faster, maybe about 40% faster but not sure exactly"
Output bullet: "Streamlined CI/CD pipeline, reducing average deployment time by approximately 40% through parallelisation and caching build artefacts."
Note: Preserved user's approximate phrasing ("approximately 40%") — did not round up or claim exactness.
</example>

<example id="3" case="no-metric-available">
Input bullet: "Led migration from monolith to microservices"
User-verified fact: (none provided)
Output bullet: "Led end-to-end migration from a monolithic application to a microservices architecture, enabling independent service deployment and reducing cross-team release coupling."
Note: No numbers, no named technology, no scope count — none present in the source bullet. Output uses only concepts from the original bullet (monolith, microservices, independent deployment) without adding specifics.
</example>

<example id="4" case="refuse-jd-driven-tech-swap">
JD requires: React
Experience tech lock for this experience: [angular, nx, typescript]
Input bullet: "Optimized Angular microfrontends with lazy loading and Nx modularization, achieving ~40% performance gains."
User-verified fact: (none provided)
Output bullet: "Optimized Angular microfrontends with lazy loading and Nx modularization, achieving ~40% performance gains through route-level code splitting."
Note: JD asks for React, but this experience's EXPERIENCE_TECH_LOCK does not include React, so Angular MUST stay. We strengthened the bullet qualitatively (added "route-level code splitting") without swapping the framework. Substituting "React" here would be a banned hallucination even though the candidate lists React in their global skills.
</example>

<example id="5" case="refuse-jd-driven-tech-addition">
JD requires: PostgreSQL, Redis
Experience tech lock for this experience: [mongodb, nodejs, express]
Input bullet: "Built an Express-based API aggregator consolidating multiple frontend calls into a single request."
User-verified fact: (none provided)
Output bullet: "Engineered an Express-based API aggregator that consolidated multiple frontend calls into a single request, simplifying the client integration surface."
Note: JD wants PostgreSQL and Redis, but this experience's lock does not include them and the source bullet does not mention any database or cache. Adding "backed by PostgreSQL" or "cached via Redis" would be a banned hallucination. We strengthen the bullet using only the concepts that are actually there (aggregation, single request, client integration).
</example>

</examples>`;
