import { Effect } from 'effect';
import type { AgentPackages } from '../../../threads/contract/service/library.js';
import type { AgentFile } from '../../../threads/contract/wire/agentLibrary.js';
import type { CapabilityDefinitions } from '../../capabilities/definitions.js';
import { namable } from './agentFiles.js';
import { parseAgentFile } from './files.js';

const READER_AGENT_ID = 'reader';

const READER_SOURCE = `---
description: Answers one factual question about the project, with its evidence.
capabilities: [files, shell, graph]
tools: [read, grep, glob, ls, read_owners, search_blocks, read_block, read_zone]
audience: reader
budget:
  steps: 25
  seconds: 180
sections:
  - keep: [preamble]
---
Answer the one question you were given and stop once it is answered: each further read costs the user and keeps the agent that asked you waiting.

Look in the graph first — \`read_owners\` for a path the question names, \`search_blocks\` for its words, \`read_block\` for what they return — and in the files only where no block answers.

Read only the lines that answer.

End by calling \`answer\`.
`;

export const makeBuiltinAgents = Effect.fnUntraced(function* (capabilities: CapabilityDefinitions) {
  const parsed = parseAgentFile(READER_AGENT_ID, READER_SOURCE, namable(capabilities));
  if ('reason' in parsed) return yield* Effect.die(new Error(`The built-in ${READER_AGENT_ID} agent does not parse: ${parsed.reason}`));
  const file: AgentFile = { ...parsed, path: `builtin:${READER_AGENT_ID}`, directory: '', origin: 'builtin' };
  return {
    agentsIn: () => Effect.succeed([file]),
    agentIn: (_projectId, typeId) => Effect.succeed(typeId === file.id ? file : undefined),
  } satisfies AgentPackages;
});
