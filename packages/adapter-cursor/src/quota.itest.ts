import { afterAll, expect } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { answering } from '@runlith/llm/route/transport/answering';
import { QuotaDoor } from '@runlith/llm/profiles/quotaRead';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { adapter } from './adapter';

const home = await mkdtemp(join(tmpdir(), 'cursor-quota-'));
afterAll(() => rm(home, { recursive: true, force: true }));
const paths = { HOME: home, USERPROFILE: home, APPDATA: home, XDG_CONFIG_HOME: home, AGENT_CLI_CREDENTIAL_STORE: 'file' };
const directory = join(home, process.platform === 'darwin' ? '.cursor' : process.platform === 'win32' ? 'Cursor' : 'cursor');
await mkdir(directory, { recursive: true });
const file = join(directory, 'auth.json');
const provider = adapter({ product: { mcpServer: 'test', client: { name: 'test', version: '1' } }, instances: [] })[0]!;
const credentials: ModelCredentials = {
  apiKey: async () => 'sdk-key',
  accessToken: async () => 'sdk-key',
  credential: async () => ({ accessToken: 'sdk-key', refreshToken: null, expiresAt: null, email: 'a@example.com' }),
};

it.live('CLI quota is accepted only for the SDK account and a later CLI login is readable without restarting', () =>
  Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const saved = Object.fromEntries(Object.keys(paths).map((key) => [key, process.env[key]]));
        Object.assign(process.env, paths);
        return saved;
      }),
      (saved) =>
        Effect.sync(() => {
          for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }),
    );
    let email = 'b@example.com';
    const http = answering((request) =>
      Response.json(request.url.endsWith('/GetMe') ? { email } : { billingCycleEnd: '1800000000000', planUsage: { totalPercentUsed: 32 } }),
    );
    const read = provider.quota!.read(credentials, 'owner').pipe(Effect.provideService(QuotaDoor, http));
    expect(yield* Effect.flip(read)).toMatchObject({ _tag: 'unavailable' });
    yield* Effect.tryPromise(() => writeFile(file, JSON.stringify({ accessToken: 'cli-token' })));
    expect(yield* Effect.flip(read)).toMatchObject({
      _tag: 'unavailable',
      reason: 'cursor-agent is signed in as b@example.com, not a@example.com.',
    });
    email = 'a@example.com';
    expect(yield* read).toMatchObject({ source: 'usage', windows: [{ label: 'Plan', usedPercent: 32, resetsAt: 1_800_000_000 }] });
    yield* Effect.tryPromise(() => unlink(file));
  }),
);
