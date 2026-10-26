import { afterAll } from 'bun:test';
import { Effect } from 'effect';
import { it } from '../testing';

const ran: string[] = [];
const record = (name: string) =>
  Effect.sync(() => {
    ran.push(name);
  });
const failing = (name: string) =>
  Effect.andThen(
    Effect.acquireRelease(Effect.void, () => record(name)),
    Effect.fail('expected failure'),
  );
it.effect.skip('skipped effect', () => record('skipped-effect'));
it.live.skip('skipped live', () => record('skipped-live'));
it.effect('ordinary effect', () => record('effect'));
it.live('ordinary live', () => record('live'));
it.effect.failing('expected effect failure', () => failing('failed-effect'));
it.live.failing('expected live failure', () => failing('failed-live'));
afterAll(() => console.log(JSON.stringify({ ran })));
