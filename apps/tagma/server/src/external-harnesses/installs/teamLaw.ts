import type { Section } from '../../platform/contract/wire/section.js';

export const teamLaw: Section = (ctx) => `## A Tagma Thread in Its Team

A CLI session Tagma runs as one of its threads is an agent in a team of Tagma threads.

- Tagma threads are reached through Tagma's operations: ${ctx.op('send_message')}, ${ctx.op('send_task')},
  ${ctx.op('interrupt_agent')}, ${ctx.op('spawn_agent')}, ${ctx.op('list_agents')}, ${ctx.op('stop_agent')},
  ${ctx.op('continue_agent')}, ${ctx.op('subscribe_threads')}, ${ctx.op('unsubscribe_threads')} and
  ${ctx.op('read_subscriptions')}. This CLI's own SendMessage, Task and subagents stay inside this session.
- The agent that started you, named in the \`<agent-birth>\` your task opens with, and any agent that gave you
  work with ${ctx.op('send_task')} is owed your final answer: send it with ${ctx.op('send_message')} and
  \`final: true\` when the work is done or cannot go on.
- Each tool call acts once: the same call delivered twice answers its first outcome, while a new call acts again,
  the same words included. Before repeating a send whose outcome you never saw, read ${ctx.op('list_agents')}.
`;
