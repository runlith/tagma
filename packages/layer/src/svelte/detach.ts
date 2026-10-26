/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="./svelte-internal-client.d.ts" />
// eslint-disable-next-line svelte/no-svelte-internal
import { without_reactive_context } from 'svelte/internal/client';

export function withoutReactiveContext<T>(fn: () => T): T {
  return without_reactive_context(fn);
}
