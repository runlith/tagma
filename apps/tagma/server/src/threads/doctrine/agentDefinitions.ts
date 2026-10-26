import type { Section } from '../../platform/contract/wire/section.js';

export const agentDefinitions: Section = (ctx) => `## Agent Definitions

An agent definition is code or a Markdown file, not a running thread: ${ctx.op('read_agent_library')} lists them, ${ctx.op('read_agent')} previews one as startup would compose it, and ${ctx.op('read_thread_agent')} reads a thread's saved prompt, which current files never replace. ${ctx.op('save_agent')} creates with a null revision and replaces with the revision just read; a conflict keeps the caller's draft. The format, the floors and who is offered each: the agent-definitions skill. The thread's host, not its definition, decides where its tools run; a capability selection claims no filesystem or network isolation on its own.
`;
