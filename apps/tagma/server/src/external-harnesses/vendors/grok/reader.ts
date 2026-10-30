import type { MetadataReader } from '@runlith/tagma/adapter/metadata';
import { grokEnds } from './ends.js';
import { grokSources } from './metadata.js';

export const grokReader: MetadataReader = {
  sources: grokSources,
  provenance: {
    model: { source: 'session-store', readable: true },
    effort: { source: 'session-store', readable: false },
    title: { source: 'session-store', readable: true },
  },
  ends: grokEnds,
};
