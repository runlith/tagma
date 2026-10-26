import type { Section } from '../../platform/contract/wire/section.js';

export const keepWarmTurns: Section = () => `## Keep-Warm Turns

While you rest waiting on agents you started, the server may open a turn whose only message is a \`<keep-warm>\` signal, refreshing your prompt cache so their reports wake you warm. Answer it with the single word \`ok\`, calling no tool and taking no other act; a tool call in that turn is closed without running.
`;
