import { describe, expect } from 'bun:test';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { TestConsole } from 'effect/testing';
import { GRANT_VARIABLE } from '../../platform/contract/service/credentials.js';
import { CurrentInvocation, Invocation } from '../../platform/cli/verb.js';
import type { TouchBrief } from '../../graph/contract/service/orientation.js';
import { hookEventOf } from '../hooks/dispatch.js';
import { builtinRows } from './hookRows.js';
import { hookConnectOver } from '../hooks/door.js';

describe('post-tool context', () => {
  it.effect('a read delivers the source guidance in the protocol of the reporting harness', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'hook-context-' });
      const text = 'Keep the exported boundary stable.';
      const brief: TouchBrief = {
        place: `${root}/source.ts`,
        as: 'read',
        rules: [],
        explanations: [{ name: 'source', identity: 'source', revision: 'current', title: 'The boundary', body: text }],
        tagPrompts: [],
        touches: [],
      };
      for (const name of ['cursor', 'devin'] as const) {
        const connect = hookConnectOver(() =>
          Effect.succeed({
            operations: {
              perform: (request) => {
                switch (request.params.id) {
                  case 'report_harness_event':
                    return Effect.succeed({
                      status: 'reported',
                      outcome: 'kept',
                      revision: 1,
                      cause: null,
                      harness: name,
                      transport: 'terminal',
                    });
                  case 'touch_path':
                    return Effect.succeed({ status: 'ok', briefs: [brief], places: [] });
                  case 'guide_harness':
                    return Effect.succeed({ status: 'guided', text });
                  default:
                    return Effect.die(`the context hook does not call ${request.params.id}`);
                }
              },
            },
          }),
        );
        const at = new Invocation(
          { [GRANT_VARIABLE]: 'fixture-grant', TMPDIR: root },
          root,
          () =>
            new Blob([
              JSON.stringify({
                session_id: name,
                tool_name: 'read',
                tool_input: { file_path: `${root}/source.ts` },
              }),
            ]).stream(),
          'hook',
        );
        yield* hookEventOf('post-tool-use', at, connect, builtinRows(null)!).pipe(Effect.provideService(CurrentInvocation, at));
      }
      expect((yield* TestConsole.logLines).map((line) => JSON.parse(String(line)))).toEqual([
        { additional_context: text },
        { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } },
      ]);
    }).pipe(Effect.provide(MemoryFileSystem.layer)),
  );

  it.effect('a Claude Grep, by file names or by matched lines, asks for the law of the files it found and answers it to the CLI', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'hook-search-' }));
      yield* files.makeDirectory(`${root}/src`);
      yield* files.writeFileString(`${root}/src/gate.ts`, 'export const value = 1;\n');
      yield* files.writeFileString(`${root}/src/peer.ts`, 'export const peer = value;\n');
      const text = 'Rule gate: values change only through the release table';
      const asked: unknown[] = [];
      const connect = hookConnectOver(() =>
        Effect.succeed({
          operations: {
            perform: (request) => {
              switch (request.params.id) {
                case 'report_harness_event':
                  return Effect.succeed({
                    status: 'reported',
                    outcome: 'kept',
                    revision: 1,
                    cause: null,
                    harness: 'claude-code',
                    transport: 'terminal',
                  });
                case 'touch_path':
                  asked.push((request.payload as { readonly shown: unknown }).shown);
                  return Effect.succeed({
                    status: 'ok',
                    briefs: [{ place: `${root}/src/gate.ts`, as: 'found', rules: [], explanations: [], tagPrompts: [], touches: [] }],
                    places: [],
                  });
                case 'guide_harness':
                  return Effect.succeed({ status: 'guided', text });
                default:
                  return Effect.die(`the search hook does not call ${request.params.id}`);
              }
            },
          },
        }),
      );
      const searches = [
        {
          output_mode: 'files_with_matches',
          response: { mode: 'files_with_matches', filenames: ['src/gate.ts', 'src/peer.ts'], numFiles: 2 },
        },
        {
          output_mode: 'content',
          response: { mode: 'content', numFiles: 0, filenames: [], content: 'src/gate.ts:1:export const value = 1;\nsrc/peer.ts-2-' },
        },
        {
          output_mode: 'content',
          response: { mode: 'content', numFiles: 0, filenames: [], content: 'src/gate.ts:export const value = 1;' },
        },
        { output_mode: 'content', path: 'src/peer.ts', response: { mode: 'content', numFiles: 0, filenames: [], content: '1:x' } },
      ];
      for (const search of searches) {
        const at = new Invocation(
          { [GRANT_VARIABLE]: 'fixture-grant', TMPDIR: root },
          root,
          () =>
            new Blob([
              JSON.stringify({
                hook_event_name: 'PostToolUse',
                session_id: 'search',
                cwd: root,
                tool_name: 'Grep',
                tool_input: { pattern: 'value', output_mode: search.output_mode, path: search.path },
                tool_response: search.response,
              }),
            ]).stream(),
          'hook',
        );
        yield* hookEventOf('post-tool-use', at, connect, builtinRows('claude-code')!).pipe(Effect.provideService(CurrentInvocation, at));
      }
      const found = (...names: string[]) => names.map((name) => ({ path: `${root}/src/${name}`, as: 'found' }));
      expect(asked).toEqual([found('gate.ts', 'peer.ts'), found('gate.ts', 'peer.ts'), found('gate.ts'), found('peer.ts')]);
      expect((yield* TestConsole.logLines).slice(-searches.length).map((line) => JSON.parse(String(line)))).toEqual(
        searches.map(() => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } })),
      );
    }).pipe(Effect.provide(MemoryFileSystem.layer)),
  );

  it.effect('a Codex shell call, in the form Codex 0.162.0 reports it, asks for the law of the file it read and the files it found', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'hook-codex-shell-' }));
      yield* files.makeDirectory(`${root}/docs`);
      yield* files.writeFileString(`${root}/docs/notes.txt`, 'alpha line\nbeta line\ngamma line\n');
      yield* files.writeFileString(`${root}/docs/other.md`, 'needle here\n');
      const text = 'Rule docs: notes change only with their owner';
      const asked: unknown[] = [];
      const connect = hookConnectOver(() =>
        Effect.succeed({
          operations: {
            perform: (request) => {
              switch (request.params.id) {
                case 'report_harness_event':
                  return Effect.succeed({
                    status: 'reported',
                    outcome: 'kept',
                    revision: 1,
                    cause: null,
                    harness: 'codex',
                    transport: 'terminal',
                  });
                case 'touch_path':
                  asked.push((request.payload as { readonly shown: unknown }).shown);
                  return Effect.succeed({
                    status: 'ok',
                    briefs: [{ place: `${root}/docs/notes.txt`, as: 'read', rules: [], explanations: [], tagPrompts: [], touches: [] }],
                    places: [],
                  });
                case 'guide_harness':
                  return Effect.succeed({ status: 'guided', text });
                default:
                  return Effect.die(`the shell hook does not call ${request.params.id}`);
              }
            },
          },
        }),
      );
      const calls = [
        { command: 'sed -n 1,2p docs/notes.txt', response: 'alpha line\nbeta line\n' },
        { command: 'rg -n needle docs', response: 'docs/other.md:1:needle here\n' },
      ];
      for (const call of calls) {
        const at = new Invocation(
          { [GRANT_VARIABLE]: 'fixture-grant', TMPDIR: root },
          root,
          () =>
            new Blob([
              JSON.stringify({
                session_id: 'codex-shell',
                turn_id: 'turn-1',
                cwd: root,
                hook_event_name: 'PostToolUse',
                model: 'gpt-6.1-sol',
                permission_mode: 'bypassPermissions',
                tool_name: 'Bash',
                tool_input: { command: call.command },
                tool_response: call.response,
                tool_use_id: `exec-${call.command.length}`,
              }),
            ]).stream(),
          'hook',
        );
        yield* hookEventOf('post-tool-use', at, connect, builtinRows('codex')!).pipe(Effect.provideService(CurrentInvocation, at));
      }
      expect(asked).toEqual([[{ path: `${root}/docs/notes.txt`, as: 'read' }], [{ path: `${root}/docs/other.md`, as: 'found' }]]);
      expect((yield* TestConsole.logLines).slice(-calls.length).map((line) => JSON.parse(String(line)))).toEqual(
        calls.map(() => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } })),
      );
    }).pipe(Effect.provide(MemoryFileSystem.layer)),
  );
});
