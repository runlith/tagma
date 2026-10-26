import type { Adapter } from '../../adapter';
import { parses, read } from './imports';
import { language } from './language';
import { input, inputs, resolve, resolverOf } from './resolve';

export const py = {
  ...language,
  parses,
  imports: (text, path) => read(text, path).sites,
  metrics: (text, path) => read(text, path).metrics,
  declarations: (text, path) => read(text, path).declarations,
  resolve,
  resolver: resolverOf,
  inputs,
  input: (path) => input(path),
} satisfies Adapter;
