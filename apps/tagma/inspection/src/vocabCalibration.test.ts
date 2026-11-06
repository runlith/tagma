import { describe, expect, it } from 'bun:test';
import { envelopeOf } from './builtins';
import { budgetOf, EnvelopeExceeded, PROBE_MAX_FILES } from './core/node/budget';
import { ready } from './builtins.node';

await ready('call-services');
await ready('swallowed-failures');

const CALIBRATED = ['call-services', 'swallowed-failures'] as const;

describe('calibrated vocabulary carries no repository-tuned ceiling', () => {
  it('declares no static envelope for a calibrated builtin, and refuses an unmeasured subject past its probe', () => {
    for (const id of CALIBRATED) {
      expect(envelopeOf(id)).toBeUndefined();
      expect(() => budgetOf(id, undefined).take(PROBE_MAX_FILES + 1, 0)).toThrow(EnvelopeExceeded);
    }
  });
});
