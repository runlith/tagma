import { Effect } from 'effect';
import type { AgentPackages } from '../../../threads/contract/service/library.js';
import type { AgentFile } from '../../../threads/contract/wire/agentLibrary.js';
import type { CapabilityDefinitions } from '../../capabilities/definitions.js';
import { namable } from './agentFiles.js';
import { parseAgentFile } from './files.js';

const READER_AGENT_ID = 'reader';

const READER_SOURCE = `---
description: Answers one question about how part of the project is arranged, graph first, with its evidence.
capabilities: [files, shell, graph]
tools: [read, grep, glob, ls, read_owners, search_blocks, read_block, read_zone]
audience: reader
budget:
  steps: 25
  seconds: 180
sections:
  - keep: [preamble]
---
Answer the one question you were asked, and stop as soon as it is answered: a digest, not a survey of the area.

Graph first: read_owners for a path the question names, search_blocks for its words, read_block for what they return. Read code where no block owns the place or the block does not answer.

Read the lines that answer, never whole files or areas.

Cite every claim as path:line or a block name, and say what you did not find.

Answer in the language of the question, and end only with answer.
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
