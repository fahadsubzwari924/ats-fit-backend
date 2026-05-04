export const ENRICHMENT_EXAMPLES = `<examples>

<example id="1" case="strong-quantified-answer">
Original bullet: "Built data pipeline for analytics team"
Question: "How much data did the pipeline process, and how often did it run?"
User answer: "About 2TB per day, ran every 15 minutes"
Output bullet: "Built a daily data pipeline processing ~2TB across 96 scheduled runs, enabling near-real-time analytics for the data team."
Note: User's approximate figure preserved as-is.
</example>

<example id="2" case="vague-answer">
Original bullet: "Improved test coverage across the codebase"
Question: "What was the test coverage before and after?"
User answer: "It was pretty low, I brought it up a lot — not sure of exact numbers"
Output bullet: "Drove a significant increase in test coverage across the codebase, establishing unit and integration testing standards adopted team-wide."
Note: No numbers invented. "Significant increase" reflects user's meaning without fabricating a percentage.
</example>

<example id="3" case="no-metric-available">
Original bullet: "Mentored junior engineers on the team"
Question: "How many engineers did you mentor and over what period?"
User answer: "A couple of junior devs, informally, over the year"
Output bullet: "Mentored junior engineers through informal coaching and pair programming, supporting onboarding and skill development over a year-long engagement."
Note: "A couple" is vague — not converted to a specific number.
</example>

</examples>`;
