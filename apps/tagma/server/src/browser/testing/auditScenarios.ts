import { afterAll, expect } from 'bun:test';
import { dirname } from 'node:path';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, Layer } from 'effect';
import { AUDIT_PAIRS as AUDIT } from '../audits.js';
import { Pages } from '../contract/service/pages.js';
import { PAGE_PAIRS as PAGE } from '../operations.js';
import type { EngineHost } from './scenarios.js';
import { agentIn, calling, refIn, refusalOf } from './world.js';

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

const FRAME = `<!doctype html><html lang="en"><title>Frame</title><main>
  <button style="width:40px;height:30px" onclick="parent.postMessage('Frame button pressed', '*')"><svg width="16" height="16"><rect width="16" height="16"/></svg></button>
</main>`;

const top = (frame: string) => `<!doctype html><html lang="en"><title>Audit</title><main>
  <h1>Audit</h1>
  <img src="${PIXEL}" width="40" height="40">
  <label for="field" style="color:#c4c4c4;background:#fff">Low contrast label</label><input id="field">
  <iframe src="${frame}" title="Cross-site frame" style="width:300px;height:120px;border:0"></iframe>
  <p id="state">waiting</p>
  <button onclick="alert('Audit blocked')">Ask</button>
  <script>addEventListener('message', (event) => { document.getElementById('state').textContent = event.data; });</script>
</main>`;

export const auditScenarios = (input: EngineHost): void => {
  const server: Bun.Server<undefined> = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request): Response =>
      new Response(new URL(request.url).pathname === '/frame' ? FRAME : top(`http://localhost:${server.port}/frame`), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  });
  afterAll(() => server.stop(true));
  const agent = agentIn(dirname(import.meta.path));
  layer(input.fixture().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
    `page audits on ${input.name}`,
    (it) => {
      it.effect(
        'an audit names every failing node of the page and its cross-site frame by a working ref, hidden from the page, narrowed and refused like any action',
        () =>
          Effect.gen(function* () {
            const pages = yield* Pages;
            const opened = yield* calling(
              PAGE.open_page.body.execute({ url: `http://127.0.0.1:${server.port}/`, profile: input.profile }, undefined, agent),
            );
            const page = opened.page.id;
            yield* Effect.addFinalizer(() => (pages.live(page) === undefined ? Effect.void : pages.close(page).pipe(Effect.orDie)));
            yield* calling(PAGE.wait_for_page.body.execute({ page, until: 'load', timeoutMs: 10_000 }, undefined, agent));
            const audit = (extra: Omit<Parameters<typeof AUDIT.audit_page.body.execute>[0], 'page'> = {}) =>
              calling(AUDIT.audit_page.body.execute({ page, ...extra }, undefined, agent));
            const rules = (answer: Effect.Success<ReturnType<typeof audit>>) => answer.violations.map((violation) => violation.rule);
            const nodeOf = (answer: Effect.Success<ReturnType<typeof audit>>, rule: string) =>
              answer.violations.find((violation) => violation.rule === rule)?.nodes[0];

            const full = yield* audit();
            expect(rules(full)).toEqual(expect.arrayContaining(['image-alt', 'color-contrast', 'button-name']));
            expect(full.frames).toBe(2);
            expect(full.skipped).toEqual([]);
            const image = nodeOf(full, 'image-alt')!;
            const label = nodeOf(full, 'color-contrast')!;
            const button = nodeOf(full, 'button-name')!;
            expect(label.why).toContain('contrast');
            expect(full.violations.find((violation) => violation.rule === 'color-contrast')?.wcag).toContain('wcag2aa');
            for (const node of [image, label, button]) {
              expect(node.ref).toMatch(/^e\d+$/);
              const within = yield* calling(PAGE.snapshot_page.body.execute({ page, within: node.ref! }, undefined, agent));
              expect(within.shown).toBeGreaterThan(0);
            }
            yield* calling(PAGE.act_on_page.body.execute({ page, steps: [{ action: 'click', ref: button.ref! }] }, undefined, agent));
            yield* calling(
              PAGE.wait_for_page.body.execute({ page, until: 'text', value: 'Frame button pressed', timeoutMs: 10_000 }, undefined, agent),
            );
            const seen = yield* calling(
              PAGE.evaluate_in_page.body.execute({ page, expression: '[typeof axe, typeof heldAudit]' }, undefined, agent),
            );
            expect(seen).toMatchObject({ status: 'evaluated', value: '["undefined","undefined"]' });

            const cut = yield* audit({ limit: 2 });
            expect([cut.shown, cut.total >= 3]).toEqual([2, true]);
            const narrowed = yield* audit({ within: image.ref! });
            expect(rules(narrowed)).toContain('image-alt');
            expect(rules(narrowed)).not.toContain('button-name');
            expect(nodeOf(narrowed, 'image-alt')?.ref).toBe(image.ref);
            const tagged = yield* audit({ tags: ['wcag2aa'] });
            expect(rules(tagged)).toContain('color-contrast');
            expect(rules(tagged)).not.toContain('image-alt');

            const shot = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
            const ask = refIn(shot.text, /button "Ask"/);
            const asked = yield* calling(PAGE.act_on_page.body.execute({ page, steps: [{ action: 'click', ref: ask }] }, undefined, agent));
            expect(asked.stopped).toBe(1);
            expect((yield* refusalOf(audit())).code).toBe('dialog-open');
            yield* calling(PAGE.answer_page_dialog.body.execute({ page, accept: true }, undefined, agent));
          }),
      );
    },
  );
};
