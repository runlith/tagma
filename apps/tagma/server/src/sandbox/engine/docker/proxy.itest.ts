import { expect } from 'bun:test';
import { kind, world } from '@runlith/testbed/worlds';
import { layer } from '@runlith/effect-test';
import { describe as dockerSuite } from './suite.js';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Context, Effect, Layer } from 'effect';
import { buildGuestImage, dockerSaid } from './image.js';
import { PROXY_PORT } from './layout.js';

const host = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const platform = Layer.mergeAll(host, BunChildProcessSpawner.layer.pipe(Layer.provide(host)));
const makeProxyImage = Effect.gen(function* () {
  const context = yield* Layer.build(platform);
  const image = (yield* Effect.provide(buildGuestImage(undefined), context)).digest;
  return { context, image };
});
class ProxyImage extends Context.Service<ProxyImage, Effect.Success<typeof makeProxyImage>>()('testing/ProxyImage') {}
const proxyImage = kind(ProxyImage, (_params: null) => makeProxyImage);
const docker = (args: readonly string[], doing: string) =>
  ProxyImage.use(({ context }) => Effect.provide(dockerSaid(args, doing), context));

const made: string[] = [];
const guests = Layer.effectDiscard(
  Effect.addFinalizer(() =>
    Effect.forEach(made, (name) => docker(['rm', '--force', name], 'remove a probe guest').pipe(Effect.orDie), { discard: true }),
  ),
);

const askProxy = Effect.fn('sandbox.probeProxy')(function* (granted: readonly string[], destinations: readonly string[]) {
  const { image } = yield* ProxyImage;
  const name = `tagma-proxy-probe-${Math.random().toString(36).slice(2, 10)}`;
  made.push(name);
  const probe = `
const net = require('node:net');
const server = net.createServer((socket) => socket.end('LOCAL-CANARY'));
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(443, '127.0.0.1', resolve); });
const proxy = Bun.spawn(['bun', '/opt/tagma/proxy.ts', ${JSON.stringify(
    JSON.stringify({ port: PROXY_PORT, hosts: granted }),
  )}], { stdout: 'pipe', stderr: 'pipe' });
const reader = proxy.stdout.getReader();
let ready = '';
while (!ready.includes('listening')) {
  const chunk = await reader.read();
  if (chunk.done) throw new Error('the proxy exited before it listened');
  ready += new TextDecoder().decode(chunk.value);
}
reader.releaseLock();
const answers = {};
for (const destination of ${JSON.stringify(destinations)}) {
  answers[destination] = await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: ${PROXY_PORT} });
    let said = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('deadline')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write('CONNECT ' + destination + ' HTTP/1.1\\r\\nHost: ' + destination + '\\r\\n\\r\\n'));
    socket.on('data', (bytes) => { said += bytes.toString(); });
    socket.on('end', () => resolve(said));
  });
}
console.log(JSON.stringify(answers));
proxy.kill();
await proxy.exited;
server.close();
`;
  const said = yield* docker(
    [
      'run',
      '--rm',
      '--name',
      name,
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      '65534:65534',
      '--tmpfs',
      '/tmp:rw,nosuid,nodev,uid=65534,gid=65534',
      '--tmpfs',
      '/home/guest:rw,nosuid,nodev,uid=65534,gid=65534',
      '--pids-limit',
      '128',
      '--memory',
      '512m',
      '--cpus',
      '1',
      image,
      'bun',
      '-e',
      probe,
    ],
    'run the proxy probe',
  );
  expect(said.code, said.output).toBe(0);
  const line = said.output.trim().split('\n').at(-1) ?? '{}';
  return JSON.parse(line) as Record<string, string>;
});

dockerSuite('the preparation proxy', () =>
  layer(guests.pipe(Layer.provideMerge(world(proxyImage, null))), { excludeTestServices: true })('guests', (it) => {
    it.effect('the proxy refuses loopback spellings, ungranted hosts and ports outside HTTPS', () =>
      Effect.gen(function* () {
        const spellings = ['::ffff:7f00:1', '::ffff:127.0.0.1', '127.0.0.1', '[::1]', '0:0:0:0:0:ffff:7f00:0001'];
        const granted = [...spellings.map((spelling) => spelling.replace(/^\[|\]$/g, '')), 'registry.npmjs.org'];

        const answers = yield* askProxy(granted, [
          ...spellings.map((spelling) => `${spelling.includes(':') && !spelling.startsWith('[') ? `[${spelling}]` : spelling}:443`),
          'example.com:443',
          'registry.npmjs.org:80',
        ]);

        for (const [destination, said] of Object.entries(answers)) {
          expect({ destination, admitted: said.startsWith('HTTP/1.1 200') }).toEqual({ destination, admitted: false });
          expect({ destination, reached: said.includes('LOCAL-CANARY') }).toEqual({ destination, reached: false });
        }
        expect(answers['example.com:443']?.startsWith('HTTP/1.1 403')).toBe(true);
        expect(answers['registry.npmjs.org:80']?.startsWith('HTTP/1.1 403')).toBe(true);
      }),
    );
  }),
);
