import { expect, test } from 'bun:test';
import * as PlatformError from 'effect/PlatformError';
import { spawnFailure } from './GitHubCli.js';

const missing = PlatformError.systemError({ _tag: 'NotFound', module: 'ChildProcess', method: 'spawn', pathOrDescriptor: 'gh' });
const forbidden = PlatformError.systemError({ _tag: 'PermissionDenied', module: 'ChildProcess', method: 'spawn', pathOrDescriptor: 'gh' });

test('a missing executable is unavailable only when the working directory stands', () => {
  expect(spawnFailure(missing, true, '/repo')._tag).toBe('ProgramUnavailable');
  const absent = spawnFailure(missing, false, '/missing');
  expect(absent._tag).toBe('ProgramFailed');
  if (absent._tag === 'ProgramFailed') expect(absent.phase).toBe('spawn');
});

test('a spawn permission failure is not mistaken for a missing executable', () => {
  const denied = spawnFailure(forbidden, true, '/repo');
  expect(denied._tag).toBe('ProgramFailed');
  if (denied._tag === 'ProgramFailed') expect(denied.phase).toBe('spawn');
});
