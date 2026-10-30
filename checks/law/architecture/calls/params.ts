import { defineInspection } from '@runlith/tagma/rules';
import type { Alias } from '../../declarations/resolve';

export type Capability = 'access' | 'requester' | 'request' | 'compaction' | 'asides' | 'aside' | 'asks' | 'adapters' | 'row';

export type CallSource = {
  readonly path: string;
  readonly name: string;
  readonly capability: Capability;
  readonly form: 'service' | 'type';
};

export type CallAllow = {
  readonly request: readonly string[];
  readonly ask: readonly string[];
  readonly row: readonly string[];
};

export type CallParams = {
  readonly region: readonly string[];
  readonly sources: readonly CallSource[];
  readonly rows: readonly string[];
  readonly allow: CallAllow;
  readonly aliases: readonly Alias[];
};

export const askCalls = defineInspection<CallParams>({
  program: 'checks/law/programs.ts',
  name: 'ask-calls',
  concern: 'code',
});
