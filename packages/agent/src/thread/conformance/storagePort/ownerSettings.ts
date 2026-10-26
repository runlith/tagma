import { describe, expect } from 'bun:test';
import type { Test } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import type { ThreadStorageFactory } from '../storagePort';
import { OWNER } from './support';
export function describeThreadOwnerSettingsPort<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Test<Scope.Scope | R>,
): void {
  describe(`${name}: thread owner settings port`, () => {
    test(
      'an owner who never chose an approval mode is trusted, and a saved choice is what is stored',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        expect(yield* harness.ownerSettings.approvalMode(OWNER)).toBe('trust');
        expect(yield* harness.ownerSettings.saveApprovalMode(OWNER, 'review')).toBe('review');
        expect(yield* harness.ownerSettings.approvalMode(OWNER)).toBe('review');
        expect(yield* harness.ownerSettings.saveApprovalMode(OWNER, 'trust')).toBe('trust');
      }),
    );
  });
}
