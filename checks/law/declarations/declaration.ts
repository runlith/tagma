import { defineInspection } from '@runlith/tagma/rules';
import type { ExportKind } from './facts';
import type { Alias } from './resolve';

export type DeadParams = {
  readonly region: readonly string[];
  readonly tests: readonly string[];
  readonly entries: readonly string[];
  readonly kinds: readonly ExportKind[];
  readonly published: readonly string[];
  readonly aliases: readonly Alias[];
};

export type RepeatedParams = {
  readonly region: readonly string[];
  readonly tests: readonly string[];
  readonly scope: 'exported' | 'all';
  readonly minMembers: number;
  readonly minUnion: number;
  readonly minLiterals: number;
  readonly ignoreNames: readonly string[];
  readonly aliases: readonly Alias[];
};

const program = 'checks/law/declarations/program.ts';

export const repeated = defineInspection<RepeatedParams>({ program, name: 'repeated-declarations', concern: 'code' });

export const dead = defineInspection<DeadParams>({ program, name: 'dead-code', concern: 'code' });
