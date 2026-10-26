import { Schema } from 'effect';
import type { ThreadTranscript, ThreadTranscriptEntry } from './rows';

export const ThreadRewindScope = Schema.Literals(['from', 'turn']);
export type ThreadRewindScope = typeof ThreadRewindScope.Type;

export const ThreadRewindMark = Schema.Struct({ by: Schema.String, scope: ThreadRewindScope });
export type ThreadRewindMark = typeof ThreadRewindMark.Type;

export type ThreadRewindFact = { readonly id: string; readonly scope: ThreadRewindScope; readonly runIds: readonly string[] };

export type ThreadRestoreFact = { readonly rewindId: string; readonly runIds: readonly string[] };

export type ThreadBranchedCut = {
  readonly hidden: readonly string[];
  readonly prompts: 'kept' | 'dropped';
  readonly from: string | null;
  readonly cuts: readonly { readonly from: number; readonly to: number }[];
};

export type ThreadEventDelta = {
  readonly position: number;
  readonly kind: string;
  readonly entry?: ThreadTranscriptEntry;
  readonly withdrawn?: { readonly runId: string };
  readonly rewound?: ThreadRewindFact;
  readonly restored?: ThreadRestoreFact;
};

export type ThreadEventFact = {
  readonly kind: string;
  readonly entry?: ThreadTranscriptEntry;
  readonly withdrawn?: { readonly runId: string };
  readonly rewound?: ThreadRewindFact;
  readonly restored?: ThreadRestoreFact;
  readonly branched?: ThreadBranchedCut;
};

export type ThreadEntryPlacement =
  | { readonly kind: 'append'; readonly entry: ThreadTranscriptEntry }
  | { readonly kind: 'prepend'; readonly entry: ThreadTranscriptEntry }
  | { readonly kind: 'replace'; readonly entry: ThreadTranscriptEntry }
  | { readonly kind: 'withdraw'; readonly ids: readonly string[] }
  | { readonly kind: 'mark'; readonly ids: readonly string[]; readonly rewound: ThreadRewindMark | null };

export type TranscriptHeld = {
  readonly entry: (id: string) => ThreadTranscriptEntry | undefined;
  readonly ofRun: (runId: string) => readonly ThreadTranscriptEntry[];
};

export function heldInList(transcript: ThreadTranscript): TranscriptHeld {
  return {
    entry: (id) => transcript.find((candidate) => candidate.id === id),
    ofRun: (runId) => transcript.filter((candidate) => candidate.runId === runId),
  };
}

export function placeThreadEntry(held: TranscriptHeld, fact: ThreadEventFact): ThreadEntryPlacement | null {
  if (fact.withdrawn) {
    const ids = held.ofRun(fact.withdrawn.runId).flatMap((candidate) => (candidate.type === 'system-prompt' ? [] : [candidate.id]));
    return ids.length === 0 ? null : { kind: 'withdraw', ids };
  }
  if (fact.rewound) {
    const { id, scope } = fact.rewound;
    const ids = fact.rewound.runIds.flatMap((runId) =>
      held
        .ofRun(runId)
        .flatMap((candidate) => (candidate.type === 'system-prompt' || candidate.rewound !== undefined ? [] : [candidate.id])),
    );
    return ids.length === 0 ? null : { kind: 'mark', ids, rewound: { by: id, scope } };
  }
  if (fact.restored) {
    const { rewindId } = fact.restored;
    const ids = fact.restored.runIds.flatMap((runId) =>
      held.ofRun(runId).flatMap((candidate) => (candidate.rewound?.by === rewindId ? [candidate.id] : [])),
    );
    return ids.length === 0 ? null : { kind: 'mark', ids, rewound: null };
  }
  const entry = fact.entry;
  if (!entry) return null;
  const standing = held.entry(entry.id);
  if (standing) {
    const mark = standing.rewound;
    const kept = mark === undefined || entry.rewound !== undefined ? entry : { ...entry, rewound: mark };
    return fact.kind === 'compaction'
      ? { kind: 'replace', entry: { ...kept, occurredAt: standing.occurredAt ?? kept.occurredAt } }
      : { kind: 'replace', entry: kept };
  }
  return fact.kind === 'system-prompt' ? { kind: 'prepend', entry } : { kind: 'append', entry };
}

export function markThreadEntry(entry: ThreadTranscriptEntry, rewound: ThreadRewindMark | null): ThreadTranscriptEntry {
  if (rewound !== null) return { ...entry, rewound };
  const { rewound: _cleared, ...unmarked } = entry;
  return unmarked;
}

export function applyThreadEntryPlacement(transcript: ThreadTranscript, placement: ThreadEntryPlacement): ThreadTranscript {
  switch (placement.kind) {
    case 'withdraw': {
      const gone = new Set(placement.ids);
      return transcript.filter((entry) => !gone.has(entry.id));
    }
    case 'mark': {
      const marked = new Set(placement.ids);
      return transcript.map((entry) => (marked.has(entry.id) ? markThreadEntry(entry, placement.rewound) : entry));
    }
    case 'prepend':
      return [placement.entry, ...transcript];
    case 'append':
      return [...transcript, placement.entry];
    case 'replace': {
      const index = transcript.findIndex((entry) => entry.id === placement.entry.id);
      if (index < 0) return transcript;
      const next = [...transcript];
      next[index] = placement.entry;
      return next;
    }
  }
}

export function applyThreadEntryPlacements(transcript: ThreadTranscript, placements: readonly ThreadEntryPlacement[]): ThreadTranscript {
  return placements.reduce(applyThreadEntryPlacement, transcript);
}

export function branchedPlacement(transcript: ThreadTranscript, cut: ThreadBranchedCut): ThreadEntryPlacement | null {
  const hidden = new Set(cut.hidden);
  const from =
    cut.from === null
      ? 0
      : Math.max(
          0,
          transcript.findIndex((entry) => entry.id === cut.from),
        );
  const ids = transcript.flatMap((entry, at) => {
    const prompt = entry.type === 'system-prompt';
    const gone = at < from || (prompt ? cut.prompts === 'dropped' : entry.runId !== undefined && hidden.has(entry.runId));
    return gone ? [entry.id] : [];
  });
  return ids.length === 0 ? null : { kind: 'withdraw', ids };
}

export function foldThreadTranscript(transcript: ThreadTranscript, fact: ThreadEventFact): ThreadTranscript {
  const placement = fact.branched ? branchedPlacement(transcript, fact.branched) : placeThreadEntry(heldInList(transcript), fact);
  return placement ? applyThreadEntryPlacement(transcript, placement) : transcript;
}
