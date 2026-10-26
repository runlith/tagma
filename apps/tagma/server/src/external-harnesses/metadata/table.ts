import type { HarnessAdapter } from '../contract/service/adapter.js';
import type { HarnessFields, HarnessProvenance } from '../../threads/contract/wire/harness/observation.js';
import { claudeSources } from '../vendors/claude-code/metadata.js';
import { codexSources } from '../vendors/codex/metadata.js';
import { cursorSources } from '../vendors/cursor/metadata.js';
import { devinSources } from '../vendors/devin/metadata.js';
import { grokSources } from '../vendors/grok/metadata.js';
import type { MetadataAdapter } from './sources.js';

const readers = {
  'claude-jsonl': claudeSources,
  'codex-rollout': codexSources,
  'grok-summary': grokSources,
  'devin-atif': devinSources,
  'cursor-terminal': cursorSources,
} satisfies Record<NonNullable<HarnessAdapter['metadata']>, MetadataAdapter>;

export const metadataAdapter = (adapter: HarnessAdapter): MetadataAdapter | null =>
  adapter.metadata === undefined ? null : readers[adapter.metadata];

export const metadataFieldSources: Record<
  NonNullable<HarnessAdapter['metadata']>,
  { readonly [K in keyof HarnessFields]: { readonly source: HarnessProvenance; readonly readable: boolean } | null }
> = {
  'claude-jsonl': {
    model: { source: 'transcript', readable: true },
    effort: { source: 'transcript', readable: true },
    title: { source: 'transcript', readable: true },
  },
  'codex-rollout': {
    model: { source: 'transcript', readable: true },
    effort: { source: 'transcript', readable: true },
    title: { source: 'session-store', readable: true },
  },
  'grok-summary': {
    model: { source: 'session-store', readable: true },
    effort: { source: 'session-store', readable: false },
    title: { source: 'session-store', readable: true },
  },
  'devin-atif': {
    model: { source: 'transcript', readable: true },
    effort: { source: 'transcript', readable: false },
    title: { source: 'session-store', readable: true },
  },
  'cursor-terminal': {
    model: null,
    effort: { source: 'terminal', readable: false },
    title: { source: 'terminal', readable: true },
  },
};
