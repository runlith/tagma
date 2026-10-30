import type { MetadataReader } from '@runlith/tagma/adapter/metadata';
import { claudeEnds } from './ends.js';
import { claude, claudeSources, claudeWordSources } from './metadata.js';

export const claudeReader: MetadataReader = {
  sources: claudeSources,
  provenance: {
    model: { source: 'transcript', readable: true },
    effort: { source: 'transcript', readable: true },
    title: { source: 'transcript', readable: true },
  },
  words: { sources: claudeWordSources, usage: true },
  ends: claudeEnds,
  artifact: { fold: claude, scan: 'whole-file' },
};
