import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { reportPath } from '@runlith/testbed/fixture';
import { layer } from '@runlith/effect-test';
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Queue, Stream } from 'effect';
import { Screencast } from '../contract/service/screencast.js';
import type { PageId } from '../contract/wire/ids.js';
import type { Frame, ScreencastEvent } from '../contract/wire/screencast.js';
import { Pages } from '../contract/service/pages.js';
import { PAGE_PAIRS as PAGE, PROFILE_PAIRS as PROFILE } from '../operations.js';
import { AUDIT_PAIRS } from '../audits.js';
import { TRACE_PAIRS } from '../traces.js';
import { agentIn, calling, refIn, refusalOf, type Served } from './world.js';
import type { EngineHost } from './scenarios.js';

class Site extends Context.Service<
  Site,
  {
    readonly url: string;
    readonly directory: string;
    readonly picker: Effect.Effect<void>;
    readonly release: Effect.Effect<boolean>;
    readonly collision: Effect.Effect<void>;
  }
>()('testing/InputSite') {}

const html = `<!doctype html><title>Input contract</title><style>
body { padding: 80px; } input { width: 220px; height: 32px; } button { margin: 40px; width: 120px; height: 40px; }
</style><label>Email <input id="field" value="old"></label><label>Choice <select id="choice"><option value="one">two</option><option value="two">Bee</option></select></label><button id="submit">Submit</button><output role="status" id="result"></output>
<button id="custom" role="combobox" aria-label="Custom choice" aria-controls="options">Pick</button><div role="listbox" id="options" hidden><div role="option" data-value="one">two</div><div role="option" data-value="two">Second</div></div>
<button id="upload">Upload</button><button id="late">Late upload</button><input type="file" id="attachment" hidden><output role="status" id="selection"></output><output role="status" id="uploaded"></output>
<div style="height:90px;overflow:auto;width:300px"><div style="height:400px"><button id="clipped" style="margin-top:260px">Clipped</button></div></div><output role="status" id="revealed"></output>
${Array.from({ length: 6 }, (_, index) => `<details><summary>Stop ${index}</summary></details>`).join('')}<div id="shadowHost"></div><output role="status" id="shadowStatus"></output><label>Far choice<select id="far"><option value="one">One</option><option value="two">Two</option></select></label><output role="status" id="traversed"></output><button id="contended">Contended upload</button><button id="operatorUpload" style="position:fixed;left:20px;top:20px;width:120px;height:40px;margin:0">Operator upload</button><input type="file" id="operatorFile" hidden><output role="status" id="operatorResult">operator-file=empty</output><iframe src="FRAME_SRC" style="display:block;margin-top:160px;width:360px;height:140px"></iframe><iframe src="/same-frame" style="display:block;margin-top:60px;width:360px;height:140px"></iframe><output role="status" id="remoteStatus"></output><output role="status" id="motionSaved"></output><script>
addEventListener('message', event => remoteStatus.textContent += ' ' + event.data);
const closed = shadowHost.attachShadow({mode:'closed'}); closed.innerHTML = '<button>First shadow stop</button><button>Second shadow stop</button><label>Shadow choice<select><option value="one">One</option><option value="two">Two</option></select></label>';
closed.querySelector('select').addEventListener('change', event => shadowStatus.textContent = 'shadow=' + event.target.value + ';trusted=' + event.isTrusted);
choice.addEventListener('change', event => selection.textContent = 'choice=' + choice.value + ';trusted=' + event.isTrusted);
custom.addEventListener('click', () => options.hidden = false);
options.addEventListener('click', event => { const option = event.target.closest('[role="option"]'); if (!option) return; options.hidden = true; custom.textContent = option.textContent; selection.textContent = 'custom=' + option.dataset.value + ';trusted=' + event.isTrusted; });
let uploadClicked = false, choices = 0;
upload.addEventListener('click', event => { uploadClicked = event.isTrusted; attachment.click(); });
late.addEventListener('click', async event => { uploadClicked = event.isTrusted; await fetch('/picker'); attachment.showPicker(); });
contended.addEventListener('click', async () => { await fetch('/contend'); attachment.showPicker(); });
operatorUpload.addEventListener('click', () => operatorFile.click());
operatorFile.addEventListener('change', () => operatorResult.textContent = 'operator-file=' + operatorFile.files[0]?.name);
clipped.addEventListener('click', event => revealed.textContent = 'clipped=' + event.isTrusted);
far.addEventListener('change', event => traversed.textContent = 'far=' + far.value + ';trusted=' + event.isTrusted);
attachment.addEventListener('change', event => { choices++; uploaded.textContent = 'file=' + attachment.files[0]?.name + ';size=' + attachment.files[0]?.size + ';clicked=' + uploadClicked + ';trusted=' + event.isTrusted + ';choices=' + choices; });
const points = [], paths = [], holds = [], clicks = [], keys = [], chars = []; let trusted = true, presses = 0, ups = 0, ticks = 0, scroll = 0, pressed = 0;
addEventListener('wheel', (event) => { ticks++; scroll += event.deltaY; points.length = 0; });
let entered = null;
addEventListener('mousemove', (event) => { entered ??= event.clientX > innerWidth * 0.1 && event.clientX < innerWidth * 0.9 && event.clientY > innerHeight * 0.1 && event.clientY < innerHeight * 0.9; points.push([event.clientX, event.clientY, event.timeStamp]); });
addEventListener('mousedown', event => { paths.push(points.splice(0)); pressed = event.timeStamp; });
addEventListener('mouseup', event => holds.push(event.timeStamp - pressed));
addEventListener('click', (event) => { const box = event.target.getBoundingClientRect(); clicks.push(Math.abs(event.clientX - box.x - box.width / 2) > 1 || Math.abs(event.clientY - box.y - box.height / 2) > 1); }, true);
for (const name of ['keydown', 'keypress', 'input', 'keyup']) addEventListener(name, (event) => { trusted &&= event.isTrusted; if (name === 'keydown' && event.key.length === 1 && !event.ctrlKey && !event.metaKey) keys.push(event.key); if (name === 'input' && event.data) chars.push(event.data); if (name === 'keypress' && event.key.length === 1) presses++; if (name === 'keyup' && event.key.length === 1 && !event.ctrlKey && !event.metaKey) ups++; });
submit.addEventListener('click', () => {
 const curved = paths.length > 0 && paths.every(path => { const first = path[0], last = path.at(-1); return path.length > 3 && path.some(([x, y]) => Math.abs((x-first[0])*(last[1]-first[1])-(y-first[1])*(last[0]-first[0])) > 10); });
 const forward = paths.every(path => { if(path.length < 2) return false; const first=path[0],last=path.at(-1),dx=last[0]-first[0],dy=last[1]-first[1],distance=Math.hypot(dx,dy); return path.slice(1).every((point,index)=>((point[0]-path[index][0])*dx+(point[1]-path[index][1])*dy)/distance >= -Math.SQRT2); });
 fetch('/motion', {method:'POST',body:JSON.stringify({paths,holds})}).then(()=>motionSaved.textContent='Motion saved');
 const eased = paths.every(path => { const speeds = path.slice(1).map((point, index) => Math.hypot(point[0]-path[index][0], point[1]-path[index][1])/(point[2]-path[index][2])); return speeds.length > 2 && Math.max(...speeds) > speeds[0] && Math.max(...speeds) > speeds.at(-1); });
 result.textContent = 'value=' + field.value + ';keys=' + keys.length + ';chars=' + chars.length + ';press=' + presses + ';up=' + ups + ';ticks=' + (ticks >= 3) + ';scroll=' + Math.round(scroll) + ';moves=' + paths.reduce((sum, path) => sum + path.length, 0) + ';curved=' + curved + ';offcenter=' + clicks.every(Boolean) + ';trusted=' + trusted + ';eased=' + eased + ';held=' + holds.every(duration => duration > 0) + ';forward=' + forward + ';entry=' + entered + ';corrected=' + paths.filter(path => path.length >= 6 && Math.hypot(path.at(-1)[0]-path[0][0], path.at(-1)[1]-path[0][1]) >= 60).every(path => { const end = path.at(-1), whole = Math.hypot(end[0]-path[0][0], end[1]-path[0][1]); return path.slice(1).some((point, index) => point[2] - path[index][2] > 35 && Math.hypot(end[0]-path[index][0], end[1]-path[index][1]) < whole * 0.15); }) + ';detour=' + paths.some(path => { const straight = path.length < 2 ? 0 : Math.hypot(path.at(-1)[0]-path[0][0], path.at(-1)[1]-path[0][1]); let length = 0; for (let index = 1; index < path.length; index++) length += Math.hypot(path[index][0]-path[index-1][0], path[index][1]-path[index-1][1]); return straight >= 150 && length / straight > 1.12; });
});
</script>`;

const site = Layer.effect(
  Site,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped();
    const report = reportPath();
    if (report === undefined) return yield* Effect.die('input conformance runs through testbed');
    const artifacts = `${report}.artifacts`;
    yield* files.makeDirectory(artifacts, { recursive: true });
    let motion = 0;
    yield* files.writeFileString(join(directory, 'avatar.txt'), 'avatar');
    yield* files.writeFileString(join(directory, 'late.txt'), 'late');
    const picker = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const collision = yield* Deferred.make<void>();
    const abandoned = yield* Deferred.make<void>();
    yield* Effect.addFinalizer(() => Deferred.succeed(abandoned, undefined));
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          fetch: (request): Response | Promise<Response> => {
            const path = new URL(request.url).pathname;
            if (path === '/motion')
              return Effect.runPromise(
                Effect.gen(function* () {
                  const body = yield* Effect.tryPromise(() => request.text());
                  yield* files.writeFileString(join(artifacts, `input-${server.port}-${motion++}.json`), body);
                  return new Response('recorded');
                }),
              );
            if (path === '/picker')
              return Effect.runPromise(
                Effect.andThen(Deferred.succeed(picker, undefined), Deferred.await(release)).pipe(Effect.as(new Response('ready'))),
              );
            if (path === '/contend')
              return Effect.runPromise(
                Effect.andThen(Deferred.succeed(collision, undefined), Deferred.await(abandoned)).pipe(Effect.as(new Response('ready'))),
              );
            const remote =
              '<!doctype html><title>Remote input</title><div style="height:400px"><button id="remote" style="margin-top:260px">Remote target</button><label>Frame choice Remote<select id="choice"><option value="one">One</option><option value="two">Two</option></select></label></div><script>remote.onclick=event=>parent.postMessage("remote-click="+event.isTrusted,"*");choice.onchange=event=>parent.postMessage("remote-choice="+choice.value+";trusted="+event.isTrusted,"*");parent.postMessage("Remote ready","*");</script>';
            return new Response(
              path === '/frame'
                ? remote
                : path === '/same-frame'
                  ? remote.replaceAll('Remote', 'Same').replaceAll('remote-', 'same-')
                  : html.replace('FRAME_SRC', `http://localhost:${new URL(request.url).port}/frame`),
              { headers: { 'content-type': 'text/html; charset=utf-8' } },
            );
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    );
    return Site.of({
      url: server.url.toString(),
      directory,
      picker: Deferred.await(picker),
      release: Deferred.succeed(release, undefined),
      collision: Deferred.await(collision),
    });
  }),
);

const watch = Effect.fnUntraced(function* (page: PageId) {
  const screencast = yield* Screencast;
  const notices = yield* Queue.unbounded<ScreencastEvent>();
  const first = yield* Deferred.make<Frame>();
  const fiber = yield* Effect.forkChild(
    Stream.runForEach(screencast.watch(page, { width: 1280, height: 800, scale: 1 }), (event) =>
      event.type === 'frame' ? Effect.asVoid(Deferred.succeed(first, event)) : Effect.asVoid(Queue.offer(notices, event)),
    ),
  );
  const named = yield* Queue.take(notices);
  if (named.type !== 'viewer') return yield* Effect.die('the viewer was not announced');
  return { screencast, notices, viewer: named.viewer, frame: yield* Deferred.await(first), fiber };
});

export const inputScenarios = (input: EngineHost): void => {
  layer(Layer.merge(input.fixture(), site.pipe(Layer.provide(BunFileSystem.layer))), { excludeTestServices: true })(
    `profile input on ${input.name}`,
    (it) => {
      it.effect('an operator chooser stays visible and answerable during an automated upload', () =>
        Effect.gen(function* () {
          const { url, directory, collision } = yield* Site;
          const agent = agentIn(directory);
          const profile = (yield* calling(
            PROFILE.create_profile.body.execute({ name: 'Chooser ownership', adapter: input.adapter.id }, undefined, agent),
          )).profile.id;
          yield* Effect.addFinalizer(() => calling(PROFILE.delete_profile.body.execute({ profile }, undefined, agent)).pipe(Effect.orDie));
          const page = (yield* calling(PAGE.open_page.body.execute({ url, profile }, undefined, agent))).page.id;
          const shot = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
          const watching = yield* watch(page);
          const uploading = yield* Effect.forkChild(
            calling(
              PAGE.act_on_page.body.execute(
                { page, steps: [{ action: 'upload', ref: refIn(shot.text, /button "Contended upload"/u), files: ['avatar.txt'] }] },
                undefined,
                agent,
              ),
            ),
          );
          yield* collision;
          const at = { x: 80 / watching.frame.width, y: 40 / watching.frame.height, button: 'left' as const, clicks: 1, modifiers: 0 };
          yield* watching.screencast.input(page, watching.viewer, 0, [
            { kind: 'mouse', type: 'down', ...at },
            { kind: 'mouse', type: 'up', ...at },
          ]);
          expect(yield* Effect.result(Fiber.join(uploading))).toMatchObject({ _tag: 'Failure', failure: { code: 'operator-input' } });
          expect((yield* Queue.take(watching.notices)).type).toBe('chooser');
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain('operator-file=empty');
          yield* watching.screencast.choose(page, [{ name: 'operator.txt', bytes: new TextEncoder().encode('operator') }]);
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain(
            'operator-file=operator.txt',
          );
          yield* (yield* Pages).close(page);
        }),
      );
      it.effect('human input has keyboard and pointer events, refuses diagnostics, and fast retains direct input', () =>
        Effect.gen(function* () {
          const { url, directory, picker, release } = yield* Site;
          const agent = agentIn(directory);
          const created = yield* calling(
            PROFILE.create_profile.body.execute({ name: 'Input contract', adapter: input.adapter.id }, undefined, agent),
          );
          const profile = created.profile.id;
          expect(created.profile.input).toBe('human');
          yield* Effect.addFinalizer(() => calling(PROFILE.delete_profile.body.execute({ profile }, undefined, agent)).pipe(Effect.orDie));
          const listed = yield* calling(PROFILE.list_profiles.body.execute({}, undefined, agent));
          expect(listed.profiles.find((row) => row.id === input.profile)?.input).toBe('fast');
          expect(listed.profiles.find((row) => row.id === profile)?.input).toBe('human');
          const opened = yield* calling(PAGE.open_page.body.execute({ url, profile }, undefined, agent));
          const page = opened.page.id;
          yield* calling(
            PAGE.wait_for_page.body.execute({ page, until: 'text', value: 'Remote ready', timeoutMs: 10_000 }, undefined, agent),
          );
          const shot = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
          const field = refIn(shot.text, /textbox "Email"/u);
          const submit = refIn(shot.text, /button "Submit"/u);
          yield* calling(
            PAGE.act_on_page.body.execute(
              {
                page,
                steps: [
                  { action: 'fill', ref: field, text: 'aBéЯю' },
                  { action: 'scroll', x: 10, y: 10, dy: 120 },
                  { action: 'click', ref: submit },
                ],
              },
              undefined,
              agent,
            ),
          );
          yield* calling(
            PAGE.wait_for_page.body.execute({ page, until: 'text', value: 'Motion saved', timeoutMs: 10_000 }, undefined, agent),
          );
          const human = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
          expect(human.text).toContain('value=aBéЯю;keys=5;chars=5;press=5;up=5;ticks=true;scroll=120;');
          expect(human.text).toContain(
            ';curved=true;offcenter=true;trusted=true;eased=true;held=true;forward=true;entry=true;corrected=true;detour=true',
          );
          yield* calling(PAGE.act_on_page.body.execute({ page, steps: [{ action: 'fill', ref: field, text: 'Жé🙂' }] }, undefined, agent));
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain('value="Жé🙂"');
          expect(
            (yield* refusalOf(
              calling(
                PAGE.act_on_page.body.execute({ page, steps: [{ action: 'select', ref: submit, values: ['two'] }] }, undefined, agent),
              ),
            )).code,
          ).toBe('action-failed');
          yield* calling(
            PAGE.act_on_page.body.execute(
              { page, steps: [{ action: 'click', ref: refIn(shot.text, /button "Clipped"/u) }] },
              undefined,
              agent,
            ),
          );
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain('clipped=true');
          yield* calling(
            PAGE.act_on_page.body.execute(
              { page, steps: [{ action: 'select', ref: refIn(shot.text, /combobox "Choice"/u), values: ['two'] }] },
              undefined,
              agent,
            ),
          );
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain('choice=two;trusted=true');
          expect(
            (yield* refusalOf(
              calling(
                PAGE.act_on_page.body.execute(
                  { page, steps: [{ action: 'select', ref: refIn(shot.text, /combobox "Custom choice"/u), values: ['missing'] }] },
                  undefined,
                  agent,
                ),
              ),
            )).code,
          ).toBe('action-failed');
          yield* calling(
            PAGE.act_on_page.body.execute(
              { page, steps: [{ action: 'select', ref: refIn(shot.text, /combobox "Custom choice"/u), values: ['two'] }] },
              undefined,
              agent,
            ),
          );
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain('custom=two;trusted=true');
          yield* calling(
            PAGE.act_on_page.body.execute(
              { page, steps: [{ action: 'upload', ref: refIn(shot.text, /button "Upload"/u), files: ['avatar.txt'] }] },
              undefined,
              agent,
            ),
          );
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain(
            'file=avatar.txt;size=6;clicked=true;trusted=true;choices=1',
          );
          expect(
            (yield* refusalOf(
              calling(
                PAGE.act_on_page.body.execute(
                  { page, steps: [{ action: 'upload', ref: submit, files: ['avatar.txt'] }] },
                  undefined,
                  agent,
                ),
              ),
            )).code,
          ).toBe('action-failed');
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain(';choices=1');
          const watching = yield* watch(page);
          const late = yield* Effect.forkChild(
            calling(
              PAGE.act_on_page.body.execute(
                { page, steps: [{ action: 'upload', ref: refIn(shot.text, /button "Late upload"/u), files: ['late.txt'] }] },
                undefined,
                agent,
              ),
            ),
          );
          yield* picker;
          yield* release;
          yield* Fiber.join(late);
          yield* Fiber.interrupt(watching.fiber);
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain(';choices=2');
          yield* calling(
            PAGE.act_on_page.body.execute(
              { page, steps: [{ action: 'select', ref: refIn(shot.text, /combobox "Far choice"/u), values: ['two'] }] },
              undefined,
              agent,
            ),
          );
          const revealed = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
          expect(revealed.text).toContain('clipped=true');
          expect(revealed.text).toContain('far=two;trusted=true');
          yield* calling(
            PAGE.act_on_page.body.execute(
              { page, steps: [{ action: 'click', ref: refIn(shot.text, /button "Remote target"/u) }] },
              undefined,
              agent,
            ),
          );
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain('remote-click=true');
          yield* calling(
            PAGE.act_on_page.body.execute(
              { page, steps: [{ action: 'select', ref: refIn(shot.text, /combobox "Frame choice Remote"/u), values: ['two'] }] },
              undefined,
              agent,
            ),
          );
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain(
            'remote-choice=two;trusted=true',
          );
          yield* calling(
            PAGE.act_on_page.body.execute(
              { page, steps: [{ action: 'click', ref: refIn(shot.text, /button "Same target"/u) }] },
              undefined,
              agent,
            ),
          );
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain('same-click=true');
          yield* calling(
            PAGE.act_on_page.body.execute(
              { page, steps: [{ action: 'select', ref: refIn(shot.text, /combobox "Shadow choice"/u), values: ['two'] }] },
              undefined,
              agent,
            ),
          );
          expect((yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent))).text).toContain('shadow=two;trusted=true');
          const restricted: readonly Effect.Effect<unknown, unknown, Served>[] = [
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
          yield* calling(
            PAGE.wait_for_page.body.execute({ page, until: 'text', value: 'Remote ready', timeoutMs: 10_000 }, undefined, agent),
          );
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
          yield* calling(PAGE.wait_for_page.body.execute({ page, until: 'text', value: 'value=aBé', timeoutMs: 10_000 }, undefined, agent));
          const fast = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
          expect(fast.text).toContain(
            'value=aBé;keys=0;chars=1;press=0;up=0;ticks=false;scroll=120;moves=1;curved=false;offcenter=false;trusted=true',
          );
          yield* (yield* Pages).close(page);
        }),
      );
    },
  );
};
