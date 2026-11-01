import { expect } from 'bun:test';
import { e2e } from '@runlith/e2e/browser';
import { Effect, Schema } from 'effect';
import { TERMINAL_OPERATIONS } from '../../executions/contract/wire/operations/terminalCatalog.js';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../platform/contract/service/credentials.js';
import { knownAnswer } from '../../platform/contract/wire/operation.js';
import { grantEnvironment } from '../../platform/testing/grants.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { makeE2eWorld } from './e2eWorld.js';

e2e.effect(
  'a foreign-project terminal opens beside its holder, restores without device layout, and confirms a running close',
  ({ page }) =>
    Effect.gen(function* () {
      const served = yield* makeE2eWorld();
      const home = yield* served.tenant;
      const target = yield* served.tenant;
      const thread = yield* home.thread({ title: 'Cross-project terminal holder' });
      const grant = grantEnvironment(thread.id, testSessionIdentity)[GRANT_VARIABLE]!;
      const headers = { [GRANT_HEADER]: grant };
      yield* served.world.op('search_blocks', { project: target.projectId, limit: 1 }, '', headers);
      const started = yield* served.world.op(
        'start_terminal',
        {
          operationId: 'cross-project-terminal',
          cwd: target.checkout,
          program: '/bin/sh',
          args: ['-c', 'printf terminal-ready; cat; printf terminal-closed'],
          transport: 'pty',
          lifetime: 'held',
          label: 'Cross-project shell',
        },
        '',
        headers,
      );
      expect(started.status).toBe(200);
      const inventory = yield* Schema.decodeUnknownEffect(knownAnswer(TERMINAL_OPERATIONS.read_terminals.answer))(
        yield* target.perform('read_terminals', { limit: 2 }),
      );
      const terminal = inventory.terminals.find((row) => row.record.heldBy === thread.id);
      if (terminal === undefined)
        return yield* Effect.die(new Error(`the thread's foreign terminal was not recorded: ${JSON.stringify(started.body)}`));
      const address = { execution: terminal.record.execution.execution, incarnation: terminal.record.execution.incarnation };
      yield* Effect.addFinalizer(() =>
        Effect.asVoid(
          served.world.op(
            'stop_terminal',
            {
              ...address,
              operationId: 'cross-project-terminal-cleanup',
              cause: 'explicit-stop',
            },
            `project=${target.projectId}`,
          ),
        ),
      );
      const key = `${address.execution}:${address.incarnation}`;
      yield* Effect.promise(async () => {
        await page.goto(`${served.origin}/${encodeURIComponent(target.projectName)}/chat?terminal=${encodeURIComponent(key)}`);
        await page.waitForURL((url) => url.pathname === `/${home.projectName}/chat/${thread.id}` && !url.searchParams.has('terminal'));
        const side = page.getByRole('complementary', { name: 'Tabs beside' });
        const view = side.locator(`[data-terminal-tab-id="${key}"]`);
        await view.waitFor();
        await page.locator('textarea.prompt').waitFor();
        expect(new URL(page.url()).pathname).toBe(`/${home.projectName}/chat/${thread.id}`);

        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.locator('textarea.prompt').waitFor();
        await page.locator('[data-area-toggle="1"]').click();
        await view.waitFor();
        console.info('terminal e2e restored');
        const running = await page.request.post(`${served.origin}/api/op/read_terminal_processes?project=${target.projectId}`, {
          data: address,
        });
        const processes = await running.json();
        expect(
          processes.report.processes.some(
            (process: { association?: { relation: string } }) =>
              process.association !== undefined && process.association.relation !== 'leader',
          ),
        ).toBe(true);
        await side.getByRole('button', { name: 'Close terminal', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        console.info('terminal e2e close confirmation visible');
        const stopped = page.waitForResponse((response) => response.url().includes('/api/op/stop_terminal'));
        await dialog.getByRole('button', { name: 'Stop and Close', exact: true }).click();
        const receipt = await (await stopped).json();
        expect(receipt.receipt.confirmed.length).toBeGreaterThan(0);
        await view.waitFor({ state: 'detached' });
      });
    }),
  { lanes: ['chromium'], context: { viewport: { width: 1280, height: 800 } } },
);
