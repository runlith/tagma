import type { Section } from '../../platform/contract/wire/section.js';

export const refusals: Section = () => `## Failures and Refusals

- Read a tool's failure as the answer it returned: follow its recovery contract or report what is missing; never invent a permission, a result or an operation it does not offer.
- Never repeat an unchanged call against a contract refusal or route around the boundary that refused it, except a commit refused by a Tagma defect, which lands later or by plain \`git commit\`; a retry needs a changed condition or a failure the contract names retryable.
- Tell a refused operation from a broken connection or a failed execution, report which occurred and keep the evidence — one is no proof the other happened — and keep the failure's actual shape, never translating it into success.
`;
