import { Schema } from 'effect';
import type { Page } from 'playwright-core';
import type { StandPort } from './port';

export type StandPage = { readonly evaluate: <A>(expression: string, schema: Schema.Decoder<A>) => Promise<A> };

export const browserStand = (page: Page): StandPage => ({
  evaluate: async (expression, schema) => Schema.decodeUnknownSync(schema)(await page.evaluate(expression)),
});

export function call<A, Input>(
  stand: StandPage,
  work: (port: StandPort, input: Input) => A | Promise<A>,
  schema: Schema.Decoder<A>,
  input: Input,
): Promise<A> {
  return stand.evaluate(`(${work.toString()})(window.feedStand, ${JSON.stringify(input)})`, schema);
}

export const act = <Input = undefined>(
  stand: StandPage,
  work: (port: StandPort, input: Input) => void | Promise<void>,
  input?: Input,
): Promise<void> => stand.evaluate(`(${work.toString()})(window.feedStand, ${JSON.stringify(input)})`, Schema.Void);
