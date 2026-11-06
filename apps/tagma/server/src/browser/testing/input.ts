import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { Pages } from '../contract/service/pages.js';
import { PAGE_PAIRS as PAGE, PROFILE_PAIRS as PROFILE } from '../operations.js';
import { AUDIT_PAIRS } from '../audits.js';
import { TRACE_PAIRS } from '../traces.js';
import { agentIn, calling, refIn, refusalOf, type Served } from './world.js';
import type { EngineHost } from './scenarios.js';

class Site extends Context.Service<Site, { readonly url: string }>()('testing/InputSite') {}

const html = `<!doctype html><title>Input contract</title><style>
body { padding: 80px; } input { width: 220px; height: 32px; } button { margin: 40px; width: 120px; height: 40px; }
</style><label>Email <input id="field" value="old"></label><label>Choice <select id="choice"><option value="one">One</option><option value="two">Two</option></select></label><button id="submit">Submit</button><output role="status" id="result"></output><script>
const points = [], clicks = [], keys = [], chars = []; let trusted = true, presses = 0, ups = 0, ticks = 0, scroll = 0;
addEventListener('wheel', (event) => { ticks++; scroll += event.deltaY; });
addEventListener('mousemove', (event) => points.push([event.clientX, event.clientY]));
addEventListener('click', (event) => { const box = event.target.getBoundingClientRect(); clicks.push(Math.abs(event.clientX - box.x - box.width / 2) > 1 || Math.abs(event.clientY - box.y - box.height / 2) > 1); }, true);
for (const name of ['keydown', 'keypress', 'input', 'keyup']) addEventListener(name, (event) => { trusted &&= event.isTrusted; if (name === 'keydown' && event.key.length === 1 && !event.ctrlKey && !event.metaKey) keys.push(event.key); if (name === 'input' && event.data) chars.push(event.data); if (name === 'keypress' && event.key.length === 1) presses++; if (name === 'keyup' && event.key.length === 1 && !event.ctrlKey && !event.metaKey) ups++; });
submit.addEventListener('click', () => {
 const first = points[0], last = points.at(-1);
 const curved = points.length > 3 && points.some(([x, y]) => Math.abs((x-first[0])*(last[1]-first[1])-(y-first[1])*(last[0]-first[0])) > 10);
 result.textContent = 'value=' + field.value + ';keys=' + keys.length + ';chars=' + chars.length + ';press=' + presses + ';up=' + ups + ';ticks=' + (ticks >= 3) + ';scroll=' + Math.round(scroll) + ';moves=' + points.length + ';curved=' + curved + ';offcenter=' + clicks.every(Boolean) + ';trusted=' + trusted;
});
</script>`;

const site = Layer.effect(
  Site,
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          fetch: () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    );
    return Site.of({ url: server.url.toString() });
  }),
);

export const inputScenarios = (input: EngineHost): void => {
  layer(Layer.merge(input.fixture(), site), { excludeTestServices: true })(`profile input on ${input.name}`, (it) => {
    it.effect('human input has keyboard and pointer events, refuses diagnostics, and fast retains direct input', () =>
      Effect.gen(function* () {
        const agent = agentIn('/tmp');
        const created = yield* calling(
          PROFILE.create_profile.body.execute({ name: 'Input contract', adapter: input.adapter.id }, undefined, agent),
        );
        const profile = created.profile.id;
        expect(created.profile.input).toBe('human');
        yield* Effect.addFinalizer(() => calling(PROFILE.delete_profile.body.execute({ profile }, undefined, agent)).pipe(Effect.orDie));
        const listed = yield* calling(PROFILE.list_profiles.body.execute({}, undefined, agent));
        expect(listed.profiles.find((row) => row.id === input.profile)?.input).toBe('fast');
        expect(listed.profiles.find((row) => row.id === profile)?.input).toBe('human');
        const { url } = yield* Site;
        const opened = yield* calling(PAGE.open_page.body.execute({ url, profile }, undefined, agent));
        const page = opened.page.id;
        const shot = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
        const field = refIn(shot.text, /textbox "Email"/u);
        const submit = refIn(shot.text, /button "Submit"/u);
        yield* calling(
          PAGE.act_on_page.body.execute(
            {
              page,
              steps: [
                { action: 'fill', ref: field, text: 'aBé' },
                { action: 'scroll', x: 10, y: 10, dy: 120 },
                { action: 'click', ref: submit },
              ],
            },
            undefined,
            agent,
          ),
        );
        const human = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
        expect(human.text).toContain('value=aBé;keys=2;chars=3;press=2;up=2;ticks=true;scroll=120;');
        expect(human.text).toContain(';curved=true;offcenter=true;trusted=true');
        const restricted: readonly Effect.Effect<unknown, unknown, Served>[] = [
          calling(
            PAGE.act_on_page.body.execute(
              { page, steps: [{ action: 'select', ref: refIn(shot.text, /combobox "Choice"/u), values: ['two'] }] },
              undefined,
              agent,
            ),
          ),
          calling(PAGE.evaluate_in_page.body.execute({ page, expression: 'document.title' }, undefined, agent)),
          calling(PAGE.read_page_console.body.execute({ page }, undefined, agent)),
          calling(PAGE.read_page_network.body.execute({ page }, undefined, agent)),
          calling(PAGE.emulate_page.body.execute({ page, device: 'iphone-15' }, undefined, agent)),
          calling(PAGE.capture_page.body.execute({ page, what: 'heap' }, undefined, agent)),
          calling(AUDIT_PAIRS.audit_page.body.execute({ page }, undefined, agent)),
          calling(TRACE_PAIRS.trace_page.body.execute({ page, action: 'start' }, undefined, agent)),
        ];
        for (const operation of restricted) expect((yield* refusalOf(operation)).code).toBe('input-mode');
        const changed = yield* calling(PROFILE.update_profile.body.execute({ profile, input: 'fast' }, undefined, agent));
        expect(changed.profile.input).toBe('fast');
        yield* calling(PAGE.navigate_page.body.execute({ page, url }, undefined, agent));
        const fresh = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
        yield* calling(
          PAGE.act_on_page.body.execute(
            {
              page,
              steps: [
                { action: 'fill', ref: refIn(fresh.text, /textbox "Email"/u), text: 'aBé' },
                { action: 'scroll', x: 10, y: 10, dy: 120 },
                { action: 'click', ref: refIn(fresh.text, /button "Submit"/u) },
              ],
            },
            undefined,
            agent,
          ),
        );
        const fast = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
        expect(fast.text).toContain(
          'value=aBé;keys=0;chars=1;press=0;up=0;ticks=false;scroll=120;moves=1;curved=false;offcenter=false;trusted=true',
        );
        yield* (yield* Pages).close(page);
      }),
    );
  });
};
