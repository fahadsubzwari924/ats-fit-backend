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

</examples>`;
