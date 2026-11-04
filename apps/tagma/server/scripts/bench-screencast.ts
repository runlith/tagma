import { Effect, Fiber, Layer, Stream } from 'effect';
import { RpcClient, RpcGroup } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { INPUT_FEED, SCREENCAST_FEED } from '../src/browser/contract/wire/feeds.ts';
import { PageId } from '../src/browser/contract/wire/ids.ts';
import { liveProtocol, rpcOf } from '../src/platform/contract/wire/live.ts';
import { TAGMA_SOCKET_PATH } from '../src/socket/rpc.ts';

const [
  base = 'http://127.0.0.1:4790',
  project = 'browser',
  projectId = '2',
  build = 'installed-chrome',
  seconds = '20',
  weight = 'light',
  rtt = '0',
] = process.argv.slice(2);
const PHASE_MS = Number(seconds) * 1000;
const RTT_MS = Number(rtt);

const LIGHT = `<style>body{margin:0;font:64px system-ui}#box{width:200px;height:200px;background:linear-gradient(45deg,#c33,#36c);animation:spin 2s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style>
  <div id="box"></div><p id="tick">0</p><script>let n=0;const tick=()=>{document.getElementById('tick').textContent=String(++n);requestAnimationFrame(tick)};tick();</script>`;

const HEAVY = `<style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas id="noise"></canvas><script>
  const canvas = document.getElementById('noise'); canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio;
  const context = canvas.getContext('2d'); const picture = context.createImageData(canvas.width, canvas.height);
  const draw = () => { const data = picture.data; for (let i = 0; i < data.length; i += 4) { const v = Math.random() * 255; data[i] = v; data[i + 1] = v * 0.8; data[i + 2] = 255 - v; data[i + 3] = 255; } context.putImageData(picture, 0, 0); requestAnimationFrame(draw); };
  draw();</script>`;

const page = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: () =>
    new Response(`<!doctype html><title>Moving</title>${weight === 'heavy' ? HEAVY : LIGHT}`, { headers: { 'content-type': 'text/html' } }),
});

const target = new URL(base);
type Leg = { peer: { write: (data: Uint8Array) => number; end: () => void } | null; held: Uint8Array[] };
const flush = (leg: Leg) => {
  while (leg.peer !== null && leg.held.length > 0) {
    const next = leg.held[0]!;
    const written = leg.peer.write(next);
    if (written === next.length) leg.held.shift();
    else {
      leg.held[0] = next.subarray(Math.max(0, written));
      return;
    }
  }
};
const delayed = (leg: Leg, data: Uint8Array) => {
  const copy = new Uint8Array(data);
  setTimeout(() => {
    leg.held.push(copy);
    flush(leg);
  }, RTT_MS / 2);
};
const proxy = Bun.listen<{ up: Leg; down: Leg }>({
  hostname: '127.0.0.1',
  port: 0,
  socket: {
    open(client) {
      const up: Leg = { peer: null, held: [] };
      const down: Leg = { peer: client, held: [] };
      client.data = { up, down };
      void Bun.connect({
        hostname: target.hostname,
        port: Number(target.port),
        socket: {
          open(server) {
            up.peer = server;
            flush(up);
          },
          data(_server, chunk) {
            delayed(down, chunk);
          },
          drain() {
            flush(up);
          },
          close() {
            setTimeout(() => client.end(), RTT_MS / 2);
          },
        },
      });
    },
    data(client, chunk) {
      delayed(client.data.up, chunk);
    },
    drain(client) {
      flush(client.data.down);
    },
    close(client) {
      setTimeout(() => client.data.up.peer?.end(), RTT_MS / 2);
    },
  },
});

const call = async (id: string, input: object): Promise<any> => {
  const response = await fetch(`${base}/api/op/${id}?project=${project}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${id} answered ${response.status}: ${JSON.stringify(body)}`);
  return body;
};

const serverPid = Number(
  Bun.spawnSync(['lsof', '-ti', `tcp:${target.port}`, '-sTCP:LISTEN'])
    .stdout.toString()
    .trim()
    .split('\n')[0],
);
const cpuSeconds = (): number => {
  const text = Bun.spawnSync(['ps', '-o', 'time=', '-p', String(serverPid)])
    .stdout.toString()
    .trim();
  return text.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
};

const created = await call('create_profile', { name: `Bench ${build}`, adapter: 'managed', document: { build } });
const profile = created.profile.id as string;
const pages: string[] = [];
for (let index = 0; index < 3; index += 1) {
  const opened = await call('open_page', { url: `http://127.0.0.1:${page.port}/?${index}`, profile });
  pages.push(opened.page.id);
}

const vitals = async (since: number) => {
  const read = await call('read_performance', { type: 'vitals', limit: 50, after: { wallTime: since, id: '0' } });
  const rows = (read.performance?.vitals ?? []) as readonly { readonly wallTime: number; readonly payload: any }[];
  const held = rows
    .filter((row) => row.wallTime >= since)
    .map((row) => row.payload.loopDelay as { p50Ms: number; p99Ms: number; maxMs: number });
  return {
    intervals: held.length,
    p50Ms: Math.max(...held.map((loop) => loop.p50Ms)),
    p99Ms: Math.max(...held.map((loop) => loop.p99Ms)),
    maxMs: Math.max(...held.map((loop) => loop.maxMs)),
  };
};

const group = RpcGroup.make(rpcOf(SCREENCAST_FEED), rpcOf(INPUT_FEED));
const protocolAt = (port: string) => {
  const url = new URL(TAGMA_SOCKET_PATH, base);
  url.protocol = 'ws:';
  url.port = port;
  return liveProtocol(url.href).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));
};

const watcher = (id: string, port: string, counted: { frames: number; bytes: number }) =>
  Effect.gen(function* () {
    const client = yield* RpcClient.make(group);
    yield* Stream.runForEach(
      client['browser.screencast'](
        { projectId: Number(projectId), page: PageId.make(id), width: 1280, height: 800, scale: 2, layout: true },
        { streamBufferSize: 1 },
      ),
      (event) =>
        Effect.sync(() => {
          if (event.type !== 'frame') return;
          counted.frames += 1;
          counted.bytes += event.data.length;
        }),
    );
  }).pipe(Effect.scoped, Effect.provide(protocolAt(port)));

const phase = (name: string, watched: readonly string[], port: string) =>
  Effect.gen(function* () {
    const counts = watched.map(() => ({ frames: 0, bytes: 0 }));
    const fibers = yield* Effect.forEach(watched, (id, index) => Effect.forkChild(watcher(id, port, counts[index]!)));
    yield* Effect.sleep('3 seconds');
    for (const count of counts) Object.assign(count, { frames: 0, bytes: 0 });
    const started = Date.now();
    const cpu = cpuSeconds();
    yield* Effect.sleep(PHASE_MS);
    const spent = cpuSeconds() - cpu;
    const frames = counts.reduce((sum, count) => sum + count.frames, 0);
    for (const fiber of fibers) yield* Fiber.interrupt(fiber);
    return {
      name,
      viewers: watched.length,
      perViewerFps: counts.map((count) => (count.frames * 1000) / PHASE_MS),
      megabytesPerSecond: (counts.reduce((sum, count) => sum + count.bytes, 0) / 1e6) * (1000 / PHASE_MS),
      serverCpuMsPerDeliveredFrame: frames === 0 ? null : (spent * 1000) / frames,
      serverCpuPercent: (spent * 100 * 1000) / PHASE_MS,
      started,
    };
  });

const report = async (name: string, watched: readonly string[], port: string) => {
  const measured = await Effect.runPromise(phase(name, watched, port));
  console.log(JSON.stringify({ ...measured, loop: await vitals(measured.started) }));
  await Bun.sleep(3_000);
};

const direct = target.port;
const delayedPort = String(proxy.port);
console.log(JSON.stringify({ rttMs: RTT_MS, weight, serverPid }));
await report('one viewer, loopback', pages.slice(0, 1), direct);
await report('two viewers of one page, loopback', [pages[0]!, pages[0]!], direct);
if (RTT_MS > 0) {
  await report(`one viewer, rtt ${RTT_MS}`, pages.slice(0, 1), delayedPort);
  await report(`two viewers of one page, rtt ${RTT_MS}`, [pages[0]!, pages[0]!], delayedPort);
}
await report('one viewer each on three pages, loopback', pages, direct);
for (const id of pages) await call('close_page', { page: id });
await call('delete_profile', { profile });
page.stop(true);
proxy.stop(true);
process.exit(0);
