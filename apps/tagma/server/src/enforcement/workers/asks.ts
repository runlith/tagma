import type { Assembled, PackId } from '@tagma/inspection/builtins';
import type { Footprint, Reading } from '@tagma/inspection/node/reading';
import type { Plan, Scope, Sliced } from '@tagma/inspection/node/slices';
import type { BindingReach, FactKind, ProgramFacts } from '@tagma/inspection/program';
import type { Debt, Verdict } from '@tagma/inspection/verdict';
import type { Context } from '@runlith/code-facts/adapter';
import type { Installed } from '@runlith/code-facts/tree';

export type ReachRequest = {
  readonly kind: 'reach';
  readonly root: string;
  readonly commit: string;
  readonly inspection: Assembled;
  readonly places: readonly string[];
  readonly previous?: { readonly inspection: Assembled; readonly fingerprints: readonly string[] };
  readonly paths?: readonly string[];
};

export type JudgeLane = 'landing' | 'merge';

export type JudgeRequest = {
  readonly kind: 'judge';
  readonly lane: JudgeLane;
  readonly root: string;
  readonly base: string;
  readonly built: string;
  readonly paths: readonly string[];
  readonly places: readonly string[];
  readonly inspection: Assembled;
  readonly debt: readonly (string | Debt)[];
  readonly readings?: {
    readonly base: Reading;
    readonly built: Reading;
    readonly compared: Compared;
    readonly installed: { readonly base: Installs; readonly built: Installs };
  };
  readonly checkout?: string;
};

export type Compared = readonly (readonly [path: string, text: string | null])[];

export type Installs = readonly (readonly [path: string, file: Installed | null])[];

export type PlanAsk = {
  readonly kind: 'plan';
  readonly root: string;
  readonly commit: string;
  readonly inspection: Assembled;
  readonly places: readonly string[];
  readonly job?: string;
  readonly measures?: true;
  readonly from?: { readonly commit: string };
  readonly compared?: Compared;
  readonly installed?: Installs;
  readonly checkout?: string;
};

export type SliceAsk = {
  readonly kind: 'slice';
  readonly root: string;
  readonly commit: string;
  readonly inspection: Assembled;
  readonly places: readonly string[];
  readonly scope: Scope;
  readonly job?: string;
  readonly measures?: true;
  readonly compared: Compared;
  readonly installed: Installs;
  readonly checkout?: string;
};

export type PackUseAsk = { readonly kind: 'packs'; readonly root: string; readonly commit: string };

export type FactsAsk = {
  readonly kind: 'facts';
  readonly root: string;
  readonly sides: readonly { readonly side: 'tree' | 'base'; readonly commit: string; readonly paths: readonly string[] | null }[];
  readonly reaches: readonly BindingReach[];
  readonly needs: readonly FactKind[];
  readonly context: Readonly<Record<string, Context>>;
  readonly ceiling: number;
};

export type HistoryQuery = {
  readonly root: string;
  readonly head: string;
  readonly after?: string;
};

export type HistoryEntry = {
  readonly commit: string;
  readonly parent: string | undefined;
  readonly forget: readonly string[];
};

export type HistoryPage = { readonly entries: readonly HistoryEntry[]; readonly done: boolean };

export type HistoryAsk =
  | { readonly kind: 'history'; readonly phase: 'start'; readonly job: string; readonly query: HistoryQuery }
  | { readonly kind: 'history'; readonly phase: 'next' | 'close'; readonly job: string };

export type RestAsk = { readonly kind: 'rest' };

export type InspectionRequest = ReachRequest | JudgeRequest;

export type WorkerAsk = InspectionRequest | PlanAsk | SliceAsk | PackUseAsk | FactsAsk | HistoryAsk | RestAsk;

export type UnreadCause = 'git' | 'source' | 'envelope';

export type Posted = WorkerAsk & { readonly id: number; readonly cacheRoot?: string };

export type Planned = { readonly compared: Compared } & ({ readonly plan: Plan } | { readonly reading: Reading } | { readonly same: true });

type Served = {
  readonly id: number;
  readonly answered: true;
  readonly read: readonly string[];
  readonly installed: Installs;
  readonly ms: number;
};

export type InspectionAnswer =
  | (Served & { readonly verdict: Verdict; readonly footprint?: Footprint })
  | (Served & Planned)
  | (Served & { readonly sliced: Sliced })
  | (Served & { readonly packs: readonly PackId[] })
  | (Served & { readonly facts: ProgramFacts; readonly hits: number })
  | (Served & { readonly history: HistoryPage })
  | (Served & { readonly rested: true })
  | { readonly id: number; readonly answered: false; readonly cause: UnreadCause; readonly reason: string; readonly split?: true };

export type StateAsk = { readonly kind: 'state'; readonly about: number; readonly look: number };

export type Spawned = {
  readonly pid: number;
  readonly command: string;
  readonly ms: number;
  readonly running: boolean | { readonly unread: string };
  readonly released: boolean;
  readonly system: 'running' | 'zombie' | 'gone' | null;
};

export type WorkerState = {
  readonly received: number;
  readonly moves: number;
  readonly spawned: readonly Spawned[];
  readonly phases: readonly { readonly name: string; readonly ms: number }[];
  readonly unread?: string;
  readonly answer?: InspectionAnswer;
};

export type StateAnswer = { readonly about: number; readonly look: number; readonly state: WorkerState };

export type LostExit = { readonly lost: 'exit'; readonly spawned: readonly Spawned[] };

export type PhaseOpened = {
  readonly phase: 'open';
  readonly about: number;
  readonly id: number;
  readonly parent: number | null;
  readonly name: string;
};

export type PhaseClosed = {
  readonly phase: 'close';
  readonly about: number;
  readonly id: number;
  readonly ended: 'ok' | 'failed' | 'interrupted';
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
};

export type PhaseEvent = PhaseOpened | PhaseClosed;
