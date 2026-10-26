import type { Section } from '../../platform/contract/wire/section.js';

export const heldProcesses: Section = (ctx) => `## Processes That Keep Running

A process meant to stay up — a dev server, a watcher — starts with ${ctx.op('start_terminal')} (\`lifetime: held\`): no wait or life bounds it, it outlives the call and the turn, and the operator sees it among the terminals. Use it only once it answers; end it with ${ctx.op('stop_terminal')} when the work is done. \`bash\` with \`waitMs: 0\` is work with an end — a build, a test run — killed when its life runs out.
`;
