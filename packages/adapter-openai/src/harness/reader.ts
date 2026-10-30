import type { MetadataReader } from '@runlith/tagma/adapter/metadata';
import { codexEnds } from './ends.js';
import { codex, codexSources, codexWordSources } from './metadata.js';

export const codexReader: MetadataReader = {
  sources: codexSources,
  provenance: {
    model: { source: 'transcript', readable: true },
    effort: { source: 'transcript', readable: true },
    title: { source: 'session-store', readable: true },
  },
  words: { sources: codexWordSources, usage: false },
  ends: codexEnds,
  artifact: { fold: codex, scan: 'one-record' },
};
