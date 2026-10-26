import { Headers } from 'effect/http';
import { orderedHeaders } from '../schema/options';

const names = new WeakMap<object, readonly string[]>();

export const headerNames = (headers: Headers.Input): readonly string[] =>
  names.get(headers) ?? (Symbol.iterator in headers ? Array.from(headers, ([name]) => name) : Object.keys(headers));

export const namedHeaders = (input: Headers.Input, order?: readonly string[]): Headers.Headers => {
  const canonical = Headers.fromInput(input);
  const declared = orderedHeaders(canonical, headerNames(input));
  names.set(canonical, Object.keys(orderedHeaders(declared, order)));
  return canonical;
};

export const declaredHeaders = (headers: Headers.Headers): Record<string, string> => orderedHeaders(headers, headerNames(headers));
