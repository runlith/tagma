import type { SourceKind } from './sources.js';
import type { BlockListRow } from './reads.js';
import type { BlockQuery } from './query.js';
import type { BlockRead } from './rows.js';
import type { VoiceAck, VoiceRefused } from '../../../platform/contract/wire/voiceAnswer.js';
import type { BlockAnswer, BlockResultAnswer, Crowded, IdleSpecAnswer } from './answers.js';
import type { ReadyTaskAnswer } from './operations/reads.js';
import type { CallRecorded } from './callRange.js';
import type { JournalPageBody } from './journal.js';
import type { WriterSession } from './operations/history.js';

export type ToolWriters = {
  readonly status: 'ok';
  readonly sessions: readonly WriterSession[];
  readonly shown: number;
  readonly total: number;
  readonly next: string | null;
};

export type ToolWriter = { readonly status: 'ok'; readonly session: WriterSession };

export type ToolBlockRead = {
  readonly status: 'ok';
  readonly reads: readonly BlockRead[];
};

export type ToolZonePage = {
  readonly status: 'ok';
  readonly page: string;
  readonly shown: number;
  readonly total: number;
  readonly next: string | null;
};

export type ToolOverview = {
  readonly status: 'ok';
  readonly overview: string;
  readonly specs?: readonly IdleSpecAnswer[];
  readonly crowded?: readonly Crowded[];
};

export type ToolBlockList = {
  readonly status: 'ok';
  readonly blocks: readonly BlockListRow[];
  readonly total: number;
  readonly next?: string | null;
  readonly sort?: BlockQuery['sort'];
};

export type ToolTaskList = {
  readonly status: 'ok';
  readonly tasks: readonly ReadyTaskAnswer[];
  readonly total: number;
  readonly shown: number;
  readonly next: string | null;
  readonly complete: boolean;
  readonly idle?: number;
  readonly workless?: number;
};

export type ToolGaugeList = {
  readonly status: 'ok';
  readonly gauges: readonly string[];
  readonly shown: number;
  readonly total: number;
  readonly next: string | null;
  readonly complete: boolean;
};

export type ToolSource = {
  readonly status: 'ok';
  readonly source: {
    readonly id: number;
    readonly kind: SourceKind;
    readonly ref: string;
    readonly symbol: string | null;
  };
};

export type ToolSync = {
  readonly status: 'ok';
  readonly sync: {
    readonly commit: string | null;
    readonly sessions: readonly string[];
    readonly files: number;
  };
};

export type ToolEvent = {
  readonly id: number;
  readonly at: string;
  readonly op: string;
  readonly blockName: string | null;
  readonly writer: string | null;
};

export type ToolEvents = {
  readonly status: 'ok';
  readonly events: readonly ToolEvent[];
  readonly shown: number;
  readonly total: number | null;
  readonly next: string | null;
  readonly complete: boolean;
};

export type ToolJournal = JournalPageBody & { readonly status: 'ok' };

export type ToolProposal = {
  readonly status: 'ok';
  readonly decided: boolean;
  readonly proposals: readonly (BlockAnswer & { readonly fields: BlockRead['fields'] })[];
  readonly total: number;
  readonly shown: number;
  readonly next: string | null;
  readonly complete: boolean;
  readonly conflicts: readonly { readonly a: string; readonly b: string; readonly region: string }[];
  readonly totalConflicts: number;
  readonly unread: readonly { readonly name: string; readonly reason: string }[];
};

export type GraphToolAnswer =
  | VoiceRefused
  | BlockResultAnswer
  | ToolBlockRead
  | ToolZonePage
  | ToolOverview
  | ToolBlockList
  | ToolTaskList
  | ToolGaugeList
  | ToolSource
  | VoiceAck
  | CallRecorded
  | ToolSync
  | ToolEvents
  | ToolJournal
  | ToolProposal
  | ToolWriters
  | ToolWriter;
