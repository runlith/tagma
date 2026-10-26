import { Effect, FileSystem } from 'effect';
import { isAbsolute } from 'node:path';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { callerPath, callerReads } from '../../platform/contract/service/subjects.js';
import { AgentLibrary } from '../contract/service/library.js';
import { WorldFiles } from '../../executions/contract/service/worlds.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { declaredRefusals } from '../refusalAnswers.js';
import { AGENT_OPERATIONS } from '../contract/wire/operations/agents.js';

export const agentSource = Effect.fn('agents.sourceOf')(function* (
  input: { readonly source?: string; readonly sourceFile?: string },
  caller: Caller,
) {
  if (input.sourceFile === undefined) return input.source;
  if (input.source !== undefined) {
    return yield* new GateRefusal('agent-source', 'source and sourceFile are alternatives.', ['Name exactly one source.']);
  }
  const path = callerPath(caller, input.sourceFile);
  if (caller.files === null && !isAbsolute(path)) {
    return yield* new GateRefusal('agent-source', `${input.sourceFile} is relative, and this caller has no proved file scope.`, [
      'Name an absolute sourceFile, or call from a native thread or proved working root.',
      'Supply the declaration directly as source.',
    ]);
  }
  const { files } = yield* WorldFiles;
  if (files === undefined) {
    return yield* new GateRefusal('agent-source', 'This world has no filesystem to read a declaration from.', [
      'Supply source text or use a world with file access.',
    ]);
  }
  return yield* Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path)).pipe(
    Effect.provide(files),
    Effect.mapError(
      (failure) =>
        new GateRefusal('agent-source', `${path}: ${failure.message}`, ['Read and correct the source file in this thread’s world.']),
    ),
  );
});

const OPS = AGENT_OPERATIONS;

export const AGENT_PAIRS = {
  read_agent_library: pair(
    OPS.read_agent_library,
    body(OPS.read_agent_library, {
      execute: Effect.fnUntraced(function* (_input) {
        const call = yield* yield* CurrentProject;
        const catalog = yield* declaredRefusals(OPS.read_agent_library)((yield* AgentLibrary).list(call.project.id));
        return { status: 'ok' as const, ...catalog };
      }),
    }),
  ),

  read_agent: pair(
    OPS.read_agent,
    body(OPS.read_agent, {
      files: (input, caller) => callerReads(caller, input.sourceFile),
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const call = yield* yield* CurrentProject;
        const source = yield* agentSource(input, caller);
        const preview = yield* declaredRefusals(OPS.read_agent)(
          (yield* AgentLibrary).preview(call.project.id, {
            id: input.id,
            source,
          }),
        );
        return { status: 'ok' as const, ...preview };
      }),
    }),
  ),
};
