import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { DateTime, Effect } from 'effect';
import { AdoptionRig, HOOK_SPAWN_BUDGET_MS, SESSION, adoptionLayer } from './hookAdoptionRig.js';
import { mintShellKey, shellDigest } from '../../../platform/credentials/grants.js';
import { TERMINAL_HEADER, TERMINAL_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { MCP_SESSION_HEADER } from '../../../platform/contract/wire/session.js';
import { terminal } from '../../../executions/testing/doubles.js';
import { sessionFor } from '../../../external-harnesses/testing/sessions.js';

layer(adoptionLayer, { excludeTestServices: true, testTimeout: 30_000, timeout: HOOK_SPAWN_BUDGET_MS })('hook adoption bridge', (it) => {
  it.effect(
    'a bridge in a Tagma shell signs as the thread whose adopted session is its own CLI session there, and as a foreign session otherwise',
    () =>
      Effect.gen(function* () {
        const { world, store, adoptedThread, facetOf, owned } = yield* AdoptionRig;
        const project = yield* world.checkout();
        const key = `bridge-${crypto.randomUUID()}`;
        const threadId = yield* adoptedThread(crypto.randomUUID(), project.id, key);
        const shell = mintShellKey();
        const execution = `shell-${crypto.randomUUID()}`;
        yield* owned(
          store.db.insert(terminal()).values({
            executionId: execution,
            incarnation: 0,
            projectId: project.id,
            transport: 'pty',
            lifetime: 'held',
            targetKey: 'bridge-target',
            holder: 'operator',
            origin: 'operator',
            revision: 0,
            shellKey: shellDigest(shell),
            acceptedAt: new Date(0),
          }),
        );
        const facet = (yield* facetOf(threadId))!;
        yield* owned(sessionFor(store.db, threadId, { ...facet, execution: { execution, incarnation: 0 } }));
        const capturedAt = DateTime.formatIso(yield* DateTime.now);
        const post = (headers: Record<string, string>) =>
          Effect.promise(() =>
            fetch(`${world.url}/api/op/report_harness_event?cwd=${encodeURIComponent(project.root)}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', ...headers },
              body: JSON.stringify({
                session: SESSION,
                occasion: 'self-description',
                capturedAt,
                event: { session_id: key },
              }),
            }),
          );
        const codeOf = (response: Response) => Effect.promise(async () => ((await response.json()) as { code?: string }).code);
        const signed = yield* post({ [MCP_SESSION_HEADER]: `claude-code:${key}`, [TERMINAL_HEADER]: shell });
        expect(signed.status).toBe(200);
        const elsewhere = yield* post({ [MCP_SESSION_HEADER]: `claude-code:${key}`, [TERMINAL_HEADER]: mintShellKey() });
        expect(yield* codeOf(elsewhere)).toBe('session-unproven');
        const another = yield* post({ [MCP_SESSION_HEADER]: `codex:${key}`, [TERMINAL_HEADER]: shell });
        expect(yield* codeOf(another)).toBe('session-unproven');
      }),
  );

  it.effect('a refused exchange leaves the hook silent and the CLI unadopted, and a hook outside a Tagma shell never asks', () =>
    Effect.gen(function* () {
      const { world, bare, proxied } = yield* AdoptionRig;
      const project = yield* world.checkout();
      const key = `refused-${crypto.randomUUID()}`;
      const proxy = yield* proxied(() => Effect.succeed(null));
      const refused = yield* world.tagma(['hook', 'pre-tool-use', '--harness', 'claude-code'], {
        cwd: project.root,
        server: proxy.server,
        stdin: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: key, tool_name: 'Edit', cwd: project.root }),
        env: { ...bare(), [TERMINAL_VARIABLE]: mintShellKey() },
      });
      expect(refused).toMatchObject({ code: 0, out: '' });
      expect(proxy.heard.adopts).toHaveLength(1);
      expect(proxy.heard.reports).toEqual([]);

      yield* world.tagma(['hook', 'pre-tool-use', '--harness', 'claude-code'], {
        cwd: project.root,
        server: proxy.server,
        stdin: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: key, tool_name: 'Edit', cwd: project.root }),
        env: bare(),
      });
      expect(proxy.heard.adopts).toHaveLength(1);
    }),
  );
});
