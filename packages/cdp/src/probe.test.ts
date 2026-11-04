import { expect, it } from 'bun:test';
import { Probe } from './probe.js';

it('a silent request spends only cumulative CPU, excluding paused samples', () => {
  const probe = new Probe(5_000);
  probe.start({ process: 'first', millis: 0 });
  expect(probe.sample({ process: 'first', millis: 0 }, false)).toBe(false);
  expect(probe.sample({ process: 'first', millis: 4_000 }, false)).toBe(false);
  expect(probe.sample({ process: 'first', millis: 10_000 }, true)).toBe(false);
  expect(probe.sample({ process: 'first', millis: 11_000 }, false)).toBe(true);
  probe.start({ process: 'first', millis: 11_000 });
  expect(probe.sample({ process: 'first', millis: 11_000 }, false)).toBe(false);
});

it('an unattributed, replaced or reset process cannot support the current request verdict', () => {
  const probe = new Probe(5_000);
  probe.start(null);
  expect(probe.sample({ process: 'first', millis: 50_000 }, false)).toBe(false);
  probe.start({ process: 'first', millis: 0 });
  expect(probe.sample({ process: 'replacement', millis: 50_000 }, false)).toBe(false);
  expect(probe.sample({ process: 'replacement', millis: 100_000 }, false)).toBe(false);
  probe.start({ process: 'replacement', millis: 100_000 });
  expect(probe.sample(null, false)).toBe(false);
  expect(probe.sample({ process: 'replacement', millis: 200_000 }, false)).toBe(false);
  probe.start({ process: 'replacement', millis: 200_000 });
  expect(probe.sample({ process: 'replacement', millis: 0 }, false)).toBe(false);
  expect(probe.sample({ process: 'replacement', millis: 50_000 }, false)).toBe(false);
});
