import { afterAll } from 'bun:test';
import { Deferred, Exit } from 'effect';
import { BENCHMARK } from './conditions.js';
import { COMPONENTS, FRAME_COMPONENT, REACT_COMPONENT } from './components.js';
import { domainFixture } from './domains.js';
import { PICK_FRAME } from './picking.js';

const PAGES: Readonly<Record<string, string>> = {
  '/benchmark': BENCHMARK,
  '/form': `<!doctype html><title>Form</title>
    <label>Name <input id="name"></label>
    <label>Notes <textarea id="notes"></textarea></label>
    <button id="add" onclick="const li = document.createElement('li'); li.textContent = 'Item ' + (document.querySelectorAll('li').length + 1); document.getElementById('list').append(li)">Add</button>
    <ul id="list"></ul><a href="/second">Second</a>`,
  '/sequence': `<!doctype html><title>Dependent form</title>
    <form onsubmit="event.preventDefault(); document.getElementById('saved').textContent = JSON.stringify([document.getElementById('name').value, document.getElementById('code').value])">
      <label>Name <input id="name" oninput="document.getElementById('code').disabled = this.value !== 'Ada'"></label>
      <label>Code <input id="code" disabled oninput="document.getElementById('save').disabled = this.value !== '42'"></label>
      <button id="save" disabled>Save</button>
    </form><output id="saved"></output>`,
  '/second': '<!doctype html><title>Second</title><h1>Second page</h1>',
  '/covered': `<!doctype html><title>Covered</title>
    <button id="under" style="position:absolute;left:20px;top:20px;width:120px;height:40px">Under</button>
    <div id="cover" style="position:absolute;left:0;top:0;width:400px;height:200px;background:rgba(0,0,0,.5)">Cookie banner</div>`,
  '/scrolled': `<!doctype html><title>Scrolled</title><body style="margin:0;height:2800px">
    <div style="height:1400px"></div><button id="flow" onclick="this.dataset.clicked = 'yes'">Below the fold</button>
    <div style="position:fixed;left:30px;top:17px">
      <button id="fixed" aria-label="Close banner" onclick="this.dataset.clicked = 'yes'"><svg width="32" height="25"><path d="M0 0H32V25H0Z"/></svg></button>
      <input id="field" aria-label="Scrolled field" style="display:block;width:120px;height:24px;margin-top:20px">
    </div>
    <button id="under" style="position:fixed;left:30px;top:140px;width:120px;height:40px">Scrolled under</button>
    <div id="scroll-cover" style="position:fixed;left:20px;top:130px;width:160px;height:60px;background:#333;color:#fff">Scroll cover</div>`,
  '/scrolled-inner': `<!doctype html><title>Scrolled inner</title><body style="margin:0;height:2000px">
    <div style="position:fixed;inset:0">
      <button style="position:absolute;left:10px;top:10px;width:120px;height:30px">Frame hidden</button>
      <button style="position:absolute;left:10px;top:70px;width:120px;height:30px">Child under</button>
      <div id="child-cover" style="position:absolute;left:0;top:60px;width:140px;height:50px;background:#aaa">Child cover</div>
      <button id="open" style="position:absolute;left:10px;top:120px;width:120px;height:30px" onclick="this.textContent = 'Frame pressed'">Frame open</button>
      <input aria-label="Scrolled frame field" style="position:absolute;left:200px;top:110px;width:150px;height:24px">
    </div><script>addEventListener('scroll', () => parent.postMessage('Child scroll ' + scrollY, '*')); addEventListener('load', () => requestAnimationFrame(() => scrollTo(0, 600)));</script>`,
  '/console': `<!doctype html><title>Console</title><p id="state">loading</p>
    <script>console.error('boom from the page'); fetch('/data').then((r) => r.text()).then(() => { document.getElementById('state').textContent = 'loaded'; });</script>`,
  '/console-shapes': `<!doctype html><title>Console shapes</title><button id="report" onclick="report()">Report</button><p id="state">waiting</p>
    <script>function report() {
      console.log('tagma: hello from the agent', { links: 382, nested: { deep: true } }, [1, 'two', null]);
      console.log('%s has %d items at %f %cstyled %o', 'cart', 3.7, 1.5, 'color: red', { id: 7 });
      console.log(new Map([['k', 1]]), new Set([2]), document.getElementById('report'), function shout(word) { return word; });
      console.table([{ a: 1, b: 'x' }]);
      console.trace('traced here');
      console.error(new TypeError('bad input'));
      console.log('%s!', '%s %s', 'Hello', 'World');
      console.log('%f|%f', Infinity, -Infinity, function pick({ x }) { return x; }, { '[[PromiseState]]': 'pending', tab: 'a\\tb' });
      setTimeout(() => { document.getElementById('state').textContent = 'reported'; throw new RangeError('thrown later'); });
    }</script>`,
  '/confirm': `<!doctype html><title>Confirm</title>
    <button id="ask" onclick="document.getElementById('said').textContent = confirm('Proceed?') ? 'yes' : 'no'">Ask</button><p id="said">none</p>`,
  '/inner': `<!doctype html><title>Inner</title>
    <button id="hidden" style="position:absolute;left:10px;top:10px;width:120px;height:30px">Hidden</button>
    <button id="open" style="position:absolute;left:10px;top:120px;width:120px;height:30px" onclick="this.textContent = 'Pressed'">Open</button>
    <input id="field" aria-label="Field" style="position:absolute;left:200px;top:110px;width:150px;height:24px">
    <input id="agree" type="checkbox" aria-label="Agree" style="position:absolute;left:200px;top:150px;width:20px;height:20px;margin:0">
    <iframe src="/nested" style="position:absolute;left:180px;top:70px;width:200px;height:30px;border:0"></iframe>
    <button style="position:absolute;left:10px;top:165px" onclick="fetch('/frame-data').then(r => r.text()).then(() => parent.postMessage('Frame data loaded', '*'))">Load data</button>`,
  '/nested': `<!doctype html><title>Nested</title><button style="margin:0" onclick="this.textContent = 'Nested pressed'">Nested</button>`,
  '/leave': `<!doctype html><title>Leave</title><input id="draft" aria-label="Draft">
    <script>addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = ''; });</script>`,
  '/pick': `<!doctype html><title>Pick</title>
    <button id="target" data-testid="pick-me" style="margin:40px;width:160px;height:50px" onclick="this.textContent = 'Clicked'">Pick me</button>
    <script>const instance = { type: { name: 'Production', __file: 'Production.vue' }, ctx: {} }; instance.ctx._ = instance; document.getElementById('target').__vueParentComponent = instance;</script>`,
};

const HEAVY = `<!doctype html><title>Heavy</title><button id="spin" onclick="fetch('/spinning'); for (;;) {}">Spin</button>${Array.from(
  { length: 100 },
  (_, at) =>
    `<section><h3>Section ${at}</h3><p>Paragraph ${at} with some words.</p><a href="#s${at}">Link ${at}</a><button>Do ${at}</button><input aria-label="Field ${at}"></section>`,
).join('')}`;

export const engineSite = () => {
  const domains = domainFixture();
  const spinning = Deferred.makeUnsafe<void>();
  const recovery = Promise.withResolvers<Response>();
  const recovering = Deferred.makeUnsafe<void>();
  const childSpinning = Deferred.makeUnsafe<void>();
  const pickThrough = Deferred.makeUnsafe<void>();
  const frameServer = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => new Response(FRAME_COMPONENT, { headers: { 'content-type': 'text/html' } }),
  });
  const frameOrigin = `http://127.0.0.1:${frameServer.port}`;
  const server: Bun.Server<undefined> = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request): Response | Promise<Response> => {
      const url = new URL(request.url);
      const path = url.pathname;
      const domainResponse = domains.respond(url, server.port!);
      if (domainResponse !== null) return domainResponse;
      if (path === '/src/Send.tsx') return new Response(REACT_COMPONENT, { headers: { 'content-type': 'text/javascript' } });
      if (path === '/pick-dev')
        return new Response(COMPONENTS.replace('FRAME_ORIGIN', frameOrigin), { headers: { 'content-type': 'text/html' } });
      if (path === '/data') return Response.json({ ok: true });
      if (path === '/frame-data') return new Response('response from the other-process frame');
      if (path === '/pick-through') {
        Deferred.doneUnsafe(pickThrough, Exit.void);
        return new Response(null, { status: 204 });
      }
      if (path === '/pick-frame')
        return new Response(PICK_FRAME.replace('FRAME_NAME', url.searchParams.get('name') ?? 'First frame'), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      if (path === '/pick-frames')
        return new Response(
          `<!doctype html><iframe src="http://localhost:${server.port}/pick-frame" style="position:absolute;left:80px;top:120px;width:300px;height:100px;border:0"></iframe>`,
          {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        );
      if (path === '/spinning') {
        Deferred.doneUnsafe(spinning, Exit.void);
        return new Response(null, { status: 204 });
      }
      if (path === '/child-spinning') {
        Deferred.doneUnsafe(childSpinning, Exit.void);
        return new Response(null, { status: 204 });
      }
      if (path === '/hung-inner')
        return new Response('<!doctype html><script>fetch("/child-spinning"); for (;;) {}</script>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      if (path === '/hung-frame')
        return new Response(`<!doctype html><iframe src="http://hung.localhost:${server.port}/hung-inner"></iframe>`, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      if (path === '/recovering-release') {
        Deferred.doneUnsafe(recovering, Exit.void);
        return recovery.promise;
      }
      if (path === '/recovering-worker')
        return new Response(
          'onmessage = async ({ data }) => { await fetch("/recovering-release"); Atomics.store(new Int32Array(data), 0, 1); };',
          { headers: { 'content-type': 'text/javascript', 'cross-origin-embedder-policy': 'require-corp' } },
        );
      if (path === '/recovering' || path === '/recovering-peer')
        return new Response(
          path === '/recovering-peer'
            ? '<!doctype html><h1>Recovery peer</h1>'
            : `<!doctype html><button onclick="fetch('/spinning'); while (!Atomics.load(flag, 0)) {}">Spin</button><script>
          const flag = new Int32Array(new SharedArrayBuffer(4));
          const worker = new Worker('/recovering-worker'); worker.postMessage(flag.buffer);
        </script>`,
          {
            headers: {
              'content-type': 'text/html',
              'cross-origin-opener-policy': 'same-origin',
              'cross-origin-embedder-policy': 'require-corp',
            },
          },
        );
      if (path === '/favicon.ico') return new Response(null, { status: 204 });
      if (path === '/heavy') return new Response(HEAVY, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (path === '/scrolled-frame') {
        return new Response(
          `<!doctype html><title>Scrolled frame</title><body style="margin:0;height:2800px">
          <iframe src="http://localhost:${server.port}/scrolled-inner" style="position:fixed;left:80px;top:140px;width:400px;height:200px;border:0"></iframe>
          <div id="frame-banner" style="position:fixed;left:80px;top:140px;width:400px;height:60px;background:#333;color:#fff">Frame banner</div>
          <p id="frame-state"></p>
          <script>addEventListener('message', event => { document.getElementById('frame-state').textContent = event.data; });</script>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      if (path === '/framed') {
        return new Response(
          `<!doctype html><title>Framed</title>
          <iframe src="http://localhost:${server.port}/inner" style="position:absolute;left:0;top:0;width:400px;height:200px;border:0"></iframe>
          <div id="banner" style="position:absolute;left:0;top:0;width:400px;height:60px;background:#333;color:#fff">Consent banner</div>
          <p id="frame-state" style="position:absolute;top:220px"></p>
          <script>addEventListener('message', event => { document.getElementById('frame-state').textContent = event.data; });</script>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      const html = PAGES[path];
      return html === undefined
        ? new Response('missing', { status: 404 })
        : new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  });
  afterAll(() => {
    server.stop(true);
    frameServer.stop(true);
  });
  return {
    domains,
    spinning,
    recover: () => recovery.resolve(new Response(null, { status: 204 })),
    recovering,
    childSpinning,
    pickThrough,
    frameOrigin,
    at: (path: string) => `http://127.0.0.1:${server.port}${path}`,
    crossSite: (path: string) => `http://localhost:${server.port}${path}`,
  };
};
