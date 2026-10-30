import type { MetadataReader } from '@runlith/tagma/adapter/metadata';
import { cursorEnds } from './ends.js';
import { cursorSources } from './metadata.js';

export const cursorReader: MetadataReader = {
  sources: cursorSources,
  provenance: {
    model: null,
    effort: { source: 'terminal', readable: false },
    title: { source: 'terminal', readable: true },
  },
  ends: cursorEnds,
};
