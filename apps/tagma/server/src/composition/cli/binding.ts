import type { VerbSources } from '../../platform/cli/verb.js';
import type { CliEnvironment } from './environment.js';

export type VerbBinding = () => Promise<unknown>;

export type VerbBindings = Readonly<Record<string, readonly VerbBinding[]>>;

export type VerbModule = { readonly id: string; readonly verbs: (...bindings: never[]) => VerbSources<CliEnvironment> };

export type CoreBindings = { readonly installation: VerbBinding; readonly operations: VerbBinding };
