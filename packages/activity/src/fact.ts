export type ActivityActor =
  | { readonly kind: 'operator' }
  | { readonly kind: 'thread'; readonly id: string }
  | { readonly kind: 'session'; readonly id: string }
  | { readonly kind: 'server'; readonly name: string };

export type ActivityTrigger = {
  readonly kind: string;
  readonly refs: readonly string[];
  readonly activity?: string;
};

export type ActivityOutcome = 'ok' | 'refused' | 'failed' | 'cancelled' | 'orphaned';

export type RunTarget = { readonly run: string };

export type ActivityParent = string | RunTarget;

export type ActivityKind<Attrs extends object, Result extends object> = {
  readonly name: string;
  readonly '~attrs'?: Attrs;
  readonly '~result'?: Result;
};

export const activityKind = <Attrs extends object, Result extends object = Record<never, never>>(
  name: string,
): ActivityKind<Attrs, Result> => ({ name });

export type ActivityNote = { readonly type: string };

export type ActivityBody = {
  readonly kind: string;
  readonly contentType: string;
  readonly encoded: Uint8Array;
  readonly series?: true;
};

export type ActivityLoss = {
  readonly scope?: 'global';
  readonly unknown?: boolean;
  readonly cause: string;
  readonly facts: number;
  readonly bodies: number;
  readonly bytes: number;
};

export type ActivityOpened = {
  readonly _tag: 'Opened';
  readonly id: string;
  readonly at: number;
  readonly parent: ActivityParent | null;
  readonly thread: string | null;
  readonly run: string | null;
  readonly project: number | null;
  readonly kind: string;
  readonly actor: ActivityActor;
  readonly trigger: ActivityTrigger | null;
  readonly attrs: object;
};

export type ActivityNoted = {
  readonly _tag: 'Noted';
  readonly activity: string | RunTarget;
  readonly at: number;
  readonly note: ActivityNote;
};

export type ActivityBodied = {
  readonly _tag: 'Bodied';
  readonly activity: string;
  readonly n: number;
  readonly at: number;
  readonly thread: string | null;
  readonly body: ActivityBody;
};

export type ActivityEnded = {
  readonly _tag: 'Ended';
  readonly activity: string;
  readonly at: number;
  readonly outcome: ActivityOutcome;
  readonly reason: string | null;
  readonly message: string | null;
  readonly result: object;
};

export type ActivityFact = ActivityOpened | ActivityNoted | ActivityBodied | ActivityEnded;
