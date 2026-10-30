import type { MetadataReader } from '@runlith/tagma/adapter/metadata';
import { devinEnds } from './ends.js';
import { devinSources, devinWordSources } from './metadata.js';

export const devinReader: MetadataReader = {
  sources: devinSources,
  provenance: {
    model: { source: 'transcript', readable: true },
    effort: { source: 'transcript', readable: false },
    title: { source: 'session-store', readable: true },
  },
  words: { sources: devinWordSources, usage: false },
  ends: devinEnds,
};
