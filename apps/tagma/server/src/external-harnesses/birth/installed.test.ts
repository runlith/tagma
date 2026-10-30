import { expect } from 'bun:test';
import { Effect } from 'effect';
import { it } from '@runlith/effect-test';
import { harnessOfTypeId, harnessSpawnTypes, harnessTypeId } from '../../threads/contract/wire/harness/types.js';
import { birthSeat } from './seat.js';
import { harnessPresentation, transportOf } from '../contract/service/table.js';
import { builtinHarness } from '../testing/builtin.js';

it.effect('birth type and stored session name agree', () =>
  Effect.gen(function* () {
    const gemini = builtinHarness('gemini');
    const install = {
      harness: 'gemini',
      presentation: harnessPresentation(gemini),
      binary: null,
      version: null,
      unreadable: null,
      serves: null,
      searching: false,
      missing: null,
    };
    const [offered] = harnessSpawnTypes([install]);
    expect(offered?.id).toBe(harnessTypeId('gemini'));
    expect(harnessOfTypeId(offered!.id)).toBe('gemini');
    expect(birthSeat(gemini, yield* transportOf(gemini, 'terminal'), { model: 'flash', reasoning: null }, {})).toMatchObject({
      facet: { name: 'gemini', sessionKey: null, execution: null },
      kernel: {
        transport: { adapter: 'terminal', profile: 'gemini', agent: null },
        capabilities: { openings: 'core-and-observed', steer: 'none', pictures: false },
        selection: { provider: 'external', model: 'flash', reasoning: null },
      },
    });
  }),
);
