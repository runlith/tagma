import { expect } from 'vitest';
import { Effect } from 'effect';
import { it } from '../vitest';

it.effect('starts with an isolated DOM in another file', () =>
  Effect.sync(() => {
    expect(document.body.children.length).toBe(0);
    document.body.append(document.createElement('aside'));
  }),
);
