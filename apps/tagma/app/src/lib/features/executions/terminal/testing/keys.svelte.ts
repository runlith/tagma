import type { Host } from '@runlith/layer/Host';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { resolveKeys } from '$lib/app/keys/resolve.js';
import { type Action, keyedOf } from '$lib/features/workspace/action.js';
import { actions } from '../../actions.js';
import { TerminalKeymap, type KeymapPolicy } from '../Keymap.js';

export function defaultKeys(host: Host): Keymap {
  const keymap = new Keymap(host, { owns: () => false, run: () => false }, undefined);
  keymap.set(resolveKeys(keyedOf(actions as readonly Action[], host), {}, []));
  return keymap;
}

export const terminalKeymap = (host: Host, policy?: () => KeymapPolicy): TerminalKeymap =>
  new TerminalKeymap(host, defaultKeys(host), policy);
