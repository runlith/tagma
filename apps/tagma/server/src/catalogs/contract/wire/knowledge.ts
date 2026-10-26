import { type Catalog, sectioned, type Tag } from '../../../graph/contract/wire/tags/declaration.js';
import type { CatalogProfile } from '../../../graph/contract/wire/tags/profile.js';

const CONNECTED = ['relates'] as const;

const decision: Tag = {
  id: 'decision',
  fields: {},
  edges: [...CONNECTED],
  gates: [],
  roles: {},
  body: { shape: 'content' },
  prompt:
    'A #decision records an accepted choice and its reasons, including the conditions that could change it. It remains in force until supersede_block replaces it with a new decision; the core supersedes relation records that state and names the successor. A decision made at a meeting relates to its #meeting. Link supporting #source records where the reasons depend on them.',
};

const person: Tag = {
  id: 'person',
  fields: {},
  edges: [...CONNECTED],
  gates: [],
  roles: {},
  body: { shape: 'content' },
  prompt:
    'A #person identifies someone other records refer to. Reuse that address instead of repeating their name; keep only context relevant to this graph.',
};

const meeting: Tag = {
  id: 'meeting',
  fields: {
    held: 'date',
    attendees: { type: 'ref', tag: 'person', many: true },
  },
  edges: [...CONNECTED],
  gates: [{ gate: 'required', field: 'held' }],
  roles: {},
  body: { shape: 'content' },
  prompt:
    'A #meeting records a conversation on its required held date; attendees references #person records. Keep the useful context and unresolved points here. Record each accepted choice as a separate #decision related to this meeting, so it can be found and replaced independently.',
};

const source: Tag = {
  id: 'source',
  fields: { location: 'string' },
  edges: [...CONNECTED],
  gates: [{ gate: 'required', field: 'location' }],
  roles: {},
  body: { shape: 'content' },
  prompt:
    'A #source identifies material supporting a claim. Its required location is a URL, path or citation precise enough to find it. Record the relevant version, passage or access conditions when they affect what it establishes. Link claims to this record and distinguish the source from your interpretation.',
};

export const knowledgeProfile: CatalogProfile = { checks: { code: false } };

export const knowledge: Catalog = {
  id: 'knowledge',
  guidance:
    'The knowledge catalog connects accepted decisions, people, meetings and the sources behind claims. Use an untagged block for other material worth keeping; the tree groups subjects. Reuse existing records and link related knowledge rather than copying it. Separate evidence from interpretation and name uncertainty. Give a subject its own address when other records need to refer to it.',
  tags: [decision, person, meeting, source].map(sectioned),
  profile: knowledgeProfile,
};
