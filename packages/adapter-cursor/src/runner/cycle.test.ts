import { expect } from 'bun:test';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import type { Outlet } from '@runlith/acp/agent';
import { hostedAgent } from '@runlith/hosted-runner/agent';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { makeCursorCycle } from './cycle.js';
import { CursorSdk, type Sending } from './channel.js';

layer(MemoryFileSystem.layer)('Cursor hosted session', (it) => {
  it.effect('a new session receives the ordered history with pictures and a resumed session gets changed instructions', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const directory = yield* files.makeTempDirectoryScoped({ prefix: 'cursor-hosted-' });
      let prompt = crypto.randomUUID();
      const sent: Sending[] = [];
      const door: HostedDoor = {
        agent: () => Effect.succeed({ prompt, web: 'none' }),
        turn: () => Effect.succeed({ prompt, context: 'turn context', web: 'none' }),
        tools: () => Effect.succeed({ names: ['read'], tools: [{ name: 'read', description: 'Read', inputSchema: {}, mutates: false }] }),
        history: () =>
          Effect.succeed([
            {
              role: 'user',
              content: [
                { type: 'text', text: 'before-image' },
                { type: 'image', data: 'cGljdHVyZQ==', mimeType: 'image/png' },
                { type: 'text', text: 'after-image' },
              ],
            },
          ]),
        call: (id, name, args) =>
          Effect.succeed({
            status: 'called',
            content: [{ type: 'text', text: JSON.stringify({ id, name, args }) }],
            failed: false,
            offered: false,
            words: [],
          }),
      };
      const boundary = CursorSdk.of({
        open: () =>
          Effect.succeed({
            id: 'cursor-session',
            close: Effect.void,
            send: (input) =>
              Effect.sync(() => {
                sent.push(input);
                return {
                  cancel: Effect.void,
                  wait: Effect.gen(function* () {
                    yield* input.event({ type: 'text', messageId: input.id, text: 'done' });
                    yield* input.event({ type: 'said', said: { messageId: input.id, toolCallIds: [] } });
                    return { status: 'finished' as const };
                  }),
                };
              }),
          }),
      });
      const outlet: Outlet = { update: () => Effect.void, notify: () => Effect.void, request: () => Effect.die('no vendor permissions') };
      const open = () =>
        Effect.map(
          makeCursorCycle(
            door,
            { stderr: () => {}, died: (reason) => Effect.die(reason) },
            { directory, apiKey: 'key' },
            { model: 'model@context=long', effort: 'high', parameters: {}, version: 'test' },
          ),
          (cycle) => hostedAgent(cycle, door)(outlet),
        );
      const first = yield* open().pipe(Effect.provideService(CursorSdk, boundary));
      const setup = yield* first.newSession({ cwd: directory, mcpServers: [] });
      expect(yield* first.prompt({ sessionId: setup.sessionId, prompt: [{ type: 'text', text: 'continue' }] })).toMatchObject({
        stopReason: 'end_turn',
      });
      expect(sent[0]!.message.images).toEqual([{ data: 'cGljdHVyZQ==', mimeType: 'image/png' }]);
      expect(sent[0]!.message.text).toContain(prompt);
      expect(sent[0]!.message.text.indexOf('before-image')).toBeLessThan(sent[0]!.message.text.indexOf('[Image 1'));
      expect(sent[0]!.message.text.indexOf('[Image 1')).toBeLessThan(sent[0]!.message.text.indexOf('after-image'));
      yield* first.ended;
      const resumed = yield* open().pipe(Effect.provideService(CursorSdk, boundary));
      yield* resumed.loadSession!({ sessionId: setup.sessionId, cwd: directory, mcpServers: [] });
      yield* resumed.prompt({ sessionId: setup.sessionId, prompt: [{ type: 'text', text: 'next' }] });
      expect(sent[1]!.force).toBe(true);
      expect(sent[1]!.message.text).not.toContain(prompt);
      prompt = crypto.randomUUID();
      yield* resumed.configure!({ sessionId: setup.sessionId, configId: 'parameters', value: '{"maxMode":"true","fast":"on"}' });
      yield* resumed.prompt({ sessionId: setup.sessionId, prompt: [{ type: 'text', text: 'changed' }] });
      expect(sent[2]!.message.text).toContain(prompt);
      expect(sent[2]!.model).toMatchObject({ id: 'model', maxMode: true });
      expect(Object.fromEntries(sent[2]!.model!.params!.map((param) => [param.id, param.value]))).toEqual({
        context: 'long',
        reasoning: 'high',
        fast: 'on',
      });
      yield* resumed.ended;
    }),
  );
});
