import type { HostChord } from '@tagma/server/platform/contract/wire/chord';
import { Service } from '@runlith/layer/key';

export class ShellKeys extends Service<{ readonly kept: readonly HostChord[] }>()('ShellKeys', { tier: 'app' }) {}

export type Origin = { readonly page: string | null; readonly frame: string | null };

export type Runner = { owns(action: string): boolean; run(action: string, origin: Origin): boolean };

export class ActionRunner extends Service<Runner>()('ActionRunner', { tier: 'app' }) {}
