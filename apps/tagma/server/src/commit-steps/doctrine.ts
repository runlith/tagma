import type { Section } from '../platform/contract/wire/section.js';

export const commitStepsSection: Section = (ctx) => `## Format

This repository has a \`tagma.config.ts\`: where it declares \`format\` commands, ${ctx.op('submit_work')} runs them over the commit's files, may rewrite files by them and names those files under \`edited\`; read such a file again before editing it. A \`format-*\` refusal is a command that failed, not findings it left: fix the file the tool names or the command in \`tagma.config.ts\`; landing without formatting takes the operator's word.
`;
