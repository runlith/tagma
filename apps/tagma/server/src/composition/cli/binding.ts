import type { VerbSources } from '../../cli/verbs.js';

export type VerbBinding = () => Promise<unknown>;

export type VerbBindings = Readonly<Record<string, readonly VerbBinding[]>>;

export type VerbModule = { readonly id: string; readonly verbs: (...bindings: never[]) => VerbSources };

export type CoreBindings = { readonly installation: VerbBinding; readonly operations: VerbBinding };
