import { afterAll } from 'bun:test';
import { Effect } from 'effect';
import { it } from '../testing';

const ran: string[] = [];
const record = (name: string) =>
  Effect.sync(() => {
    ran.push(name);
  });
it.effect.only('selected effect', () => record('effect'));
it.live.only('selected live', () => record('live'));
it.effect('ordinary effect', () => record('ordinary'));
afterAll(() => console.log(JSON.stringify({ ran })));
