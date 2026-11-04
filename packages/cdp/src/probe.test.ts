import { expect, it } from 'bun:test';
import { Probe } from './probe.js';

it('a silent request spends only its share of cumulative CPU, nothing while paused and a slowdown factor at its inverse', () => {
  const probe = new Probe(5_000);
  probe.start({ process: 'first', millis: 0 });
  expect(probe.sample({ process: 'first', millis: 0 }, 1)).toBe(false);
  expect(probe.sample({ process: 'first', millis: 4_000 }, 1)).toBe(false);
  expect(probe.sample({ process: 'first', millis: 10_000 }, 0)).toBe(false);
  expect(probe.sample({ process: 'first', millis: 20_000 }, 1 / 20)).toBe(false);
  expect(probe.sample({ process: 'first', millis: 21_000 }, 1)).toBe(true);
  probe.start({ process: 'first', millis: 21_000 });
  expect(probe.sample({ process: 'first', millis: 21_000 }, 1)).toBe(false);
});

it('an unattributed, replaced or reset process cannot support the current request verdict', () => {
  const probe = new Probe(5_000);
  expect(probe.sample(null, 1)).toBe(false);
  expect(probe.sample({ process: 'first', millis: 50_000 }, 1)).toBe(false);
  probe.start({ process: 'first', millis: 0 });
  expect(probe.sample({ process: 'replacement', millis: 50_000 }, 1)).toBe(false);
  expect(probe.sample({ process: 'replacement', millis: 100_000 }, 1)).toBe(false);
  probe.start({ process: 'replacement', millis: 100_000 });
  expect(probe.sample(null, 1)).toBe(false);
  expect(probe.sample({ process: 'replacement', millis: 200_000 }, 1)).toBe(false);
  probe.start({ process: 'replacement', millis: 200_000 });
  expect(probe.sample({ process: 'replacement', millis: 0 }, 1)).toBe(false);
  expect(probe.sample({ process: 'replacement', millis: 50_000 }, 1)).toBe(false);
});
