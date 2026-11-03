import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SignInFlow } from './SignInFlow.svelte.js';
import { AccountsRepo } from './AccountsRepo.js';
import { QueryClient } from '@tanstack/query-core';
import { Cache } from '@runlith/query/repo';
import { App, MountedApp } from '@runlith/layer/App';
import { Layer } from '@runlith/layer/Layer';
import { worldHooks } from '@runlith/layer/svelte/App.svelte';
import { Door } from '$lib/wire/Door.js';
import { Scope } from '@runlith/layer/Scope';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { testDoor } from '$lib/wire/testing.js';

const execution = { execution: 'exec-1', incarnation: 0 };
const place = { id: 7, name: 'runlith' };

const door = {
  begin: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
  refusal: vi.fn(),
  signedIn: vi.fn(),
};

const opened: string[] = [];
const cleanup: (() => Promise<void>)[] = [];

async function flow(provider = 'claude-code'): Promise<SignInFlow> {
  const client = new QueryClient();
  const app = new MountedApp(
    App.define(Layer.mergeAll(AccountsRepo, Layer.of(Door, testDoor()), Layer.of(Cache, client))),
    Layer.mergeAll(),
    worldHooks,
  );
  app.start();
  await app.ready;
  const repo = app.resolve(AccountsRepo);
  const scope = Scope.make();
  const notices = new Notices(scope);
  vi.spyOn(repo.begin, 'run').mockImplementation(door.begin);
  vi.spyOn(repo.complete, 'run').mockImplementation(door.complete);
  vi.spyOn(repo.cancel, 'run').mockImplementation(door.cancel);
  vi.spyOn(repo.status, 'refresh').mockImplementation(door.refresh);
  vi.spyOn(notices, 'refusal').mockImplementation(door.refusal);
  const made = new SignInFlow(repo, notices, { open: (url: string) => void opened.push(url) }, () => provider, { signedIn: door.signedIn });
  cleanup.push(async () => {
    made.dispose();
    await app.close();
    await scope.close();
    client.clear();
  });
  return made;
}

const pendingRow = { account: 'acct-1', label: 'Claude Code', default: false, pending: true };
const signedRow = { account: 'acct-1', label: 'maya@example.com', default: true, pending: false };

beforeEach(() => {
  vi.useFakeTimers();
  opened.length = 0;
  for (const call of Object.values(door)) call.mockReset();
  door.begin.mockResolvedValue({ flow: 'external-cli', provider: 'claude-code', account: 'acct-1', execution });
});

afterEach(async () => {
  for (const release of cleanup.splice(0)) await release();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('browser sign-in waits for the redirect to land and stops polling after it is complete', async () => {
  const authorizeUrl = 'https://provider.test/authorize?state=1';
  door.begin.mockResolvedValue({ flow: 'loopback', authorizeUrl });
  door.complete
    .mockResolvedValueOnce({ pending: true })
    .mockResolvedValueOnce({ provider: 'subscription', account: 'acct-1', label: 'maya@example.com', default: true });
  const signIn = await flow('subscription');

  await signIn.begin(null, 'loopback');
  expect(opened).toEqual([authorizeUrl]);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(signIn.pending?.flow).toBe('loopback');
  expect(door.signedIn).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(2_000);
  expect(signIn.pending).toBeNull();
  expect(door.signedIn).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(4_000);
  expect(door.complete).toHaveBeenCalledTimes(2);
});

test('a refused browser sign-in ends the wait and reports the refusal without polling again', async () => {
  const refusal = new Error('authorization refused');
  door.begin.mockResolvedValue({ flow: 'loopback', authorizeUrl: 'https://provider.test/authorize' });
  door.complete.mockRejectedValue(refusal);
  const signIn = await flow('subscription');

  await signIn.begin(null, 'loopback');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(signIn.pending).toBeNull();
  expect(door.refusal).toHaveBeenCalledWith(refusal);
  expect(door.signedIn).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4_000);
  expect(door.complete).toHaveBeenCalledTimes(1);
});

test('a CLI sign-in that lands ends as a signed outcome naming the account, and polling stops', async () => {
  door.refresh.mockResolvedValueOnce({ 'claude-code': [pendingRow] }).mockResolvedValueOnce({ 'claude-code': [signedRow] });
  const signIn = await flow();

  await signIn.begin(place, 'external-cli');
  expect(signIn.pending?.flow).toBe('external-cli');
  expect(signIn.outcome).toBeNull();

  await vi.advanceTimersByTimeAsync(4_000);
  expect(signIn.pending).not.toBeNull();
  expect(signIn.outcome).toBeNull();

  await vi.advanceTimersByTimeAsync(4_000);
  expect(signIn.pending).toBeNull();
  expect(signIn.outcome).toEqual({ kind: 'signed', label: 'maya@example.com', account: 'acct-1', execution });
  expect(door.signedIn).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(12_000);
  expect(door.refresh).toHaveBeenCalledTimes(2);
});

test('a default login the server adopted ends signed at once, with no wait, terminal or polling', async () => {
  door.begin.mockResolvedValue({ flow: 'adopted', provider: 'claude-code', account: 'default', label: 'maya@example.com' });
  const signIn = await flow();

  await signIn.begin(null);

  expect(signIn.pending).toBeNull();
  expect(signIn.place).toBeNull();
  expect(signIn.outcome).toEqual({ kind: 'signed', label: 'maya@example.com', account: 'default', execution: null });
  expect(door.signedIn).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(12_000);
  expect(door.refresh).not.toHaveBeenCalled();
  expect(door.complete).not.toHaveBeenCalled();
});

test('a CLI sign-in whose pending row vanishes ends as failed, never as signed in', async () => {
  door.refresh.mockResolvedValueOnce({ 'claude-code': [pendingRow] }).mockResolvedValueOnce({});
  const signIn = await flow();

  await signIn.begin(place, 'external-cli');
  await vi.advanceTimersByTimeAsync(4_000);
  await vi.advanceTimersByTimeAsync(4_000);

  expect(signIn.pending).toBeNull();
  expect(signIn.outcome).toEqual({ kind: 'failed', execution, retryAccount: undefined });
  expect(door.signedIn).not.toHaveBeenCalled();
  expect(door.refusal).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(12_000);
  expect(door.refresh).toHaveBeenCalledTimes(2);
});

test('a reconnect the server settled as failed ends as failed and retries the same account', async () => {
  door.begin.mockResolvedValue({ flow: 'external-cli', provider: 'claude-code', account: 'acct-9', execution });
  door.refresh.mockResolvedValue({ 'claude-code': [{ account: 'acct-9', label: 'old@cli', default: true, pending: false, failed: true }] });
  const signIn = await flow();

  await signIn.begin(place, 'external-cli', 'acct-9');
  await vi.advanceTimersByTimeAsync(4_000);

  expect(signIn.pending).toBeNull();
  expect(signIn.outcome).toEqual({ kind: 'failed', execution, retryAccount: 'acct-9' });
  expect(door.signedIn).not.toHaveBeenCalled();
});

test('an unread status keeps the wait standing instead of ending the attempt', async () => {
  door.refresh.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ 'claude-code': [signedRow] });
  const signIn = await flow();

  await signIn.begin(place, 'external-cli');
  await vi.advanceTimersByTimeAsync(4_000);
  expect(signIn.pending).not.toBeNull();
  expect(signIn.outcome).toBeNull();

  await vi.advanceTimersByTimeAsync(4_000);
  expect(signIn.outcome).toMatchObject({ kind: 'signed', label: 'maya@example.com' });
});

test('explicit CLI Cancel keeps the attempt until the owner acknowledges cancellation, and a refusal keeps it available', async () => {
  const signIn = await flow();
  await signIn.begin(place, 'external-cli');
  const refused = new Error('the login terminal could not be stopped');
  door.cancel.mockRejectedValueOnce(refused);
  await signIn.cancel();
  expect(signIn.pending).toMatchObject({ flow: 'external-cli', account: 'acct-1', execution });
  expect(door.refusal).toHaveBeenCalledWith(refused);
  let acknowledge: (value: unknown) => void = () => undefined;
  door.cancel.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  const cancelling = signIn.cancel();
  expect(signIn.pending).not.toBeNull();
  expect(signIn.busy).toBe('cancel');
  acknowledge({ status: 'cancelled' });
  await cancelling;
  expect(signIn.pending).toBeNull();
  expect(signIn.busy).toBeNull();
  expect(door.signedIn).not.toHaveBeenCalled();
});

test('an answer to a cancelled attempt writes nothing into the flow', async () => {
  let release: (read: unknown) => void = () => undefined;
  door.refresh.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const signIn = await flow();

  await signIn.begin(place, 'external-cli');
  await vi.advanceTimersByTimeAsync(4_000);
  await signIn.cancel();
  release({ 'claude-code': [signedRow] });
  await vi.advanceTimersByTimeAsync(0);

  expect(signIn.pending).toBeNull();
  expect(signIn.outcome).toBeNull();
  expect(door.signedIn).not.toHaveBeenCalled();
});
