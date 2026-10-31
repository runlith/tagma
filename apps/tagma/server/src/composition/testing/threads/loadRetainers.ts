import { Worker } from 'node:worker_threads';

export type RetainerNode = { readonly index: number; readonly type: string; readonly name: string };
export type HeapGraph = {
  readonly count: number;
  readonly edgeCount: number;
  readonly offsets: Uint32Array;
  readonly target: (edge: number) => number;
  readonly strong: (edge: number) => boolean;
  readonly kind: (edge: number) => string;
  readonly safeKind: (edge: number) => string;
  readonly edgeName: (edge: number) => string | undefined;
  readonly knownKey: (index: number, keys: ReadonlySet<string>) => string | undefined;
  readonly describe: (index: number) => RetainerNode;
  readonly size: (index: number) => number;
  readonly order: Int32Array;
  readonly vertex: Int32Array;
  readonly parent: Int32Array;
  readonly found: number;
};
export type SnapshotPaths = {
  readonly parent: Int32Array;
  readonly via: Int32Array;
  readonly synthetic: Uint8Array;
  readonly syntheticSeeds: number;
};
export type RetainerRow = RetainerNode & {
  readonly selfBytes: number;
  readonly retainedBytes: number;
  readonly dominators: readonly RetainerNode[];
};
export type RetainerSummary = { readonly nonAdditive: true; readonly reachable: number; readonly rows: readonly RetainerRow[] };

export type RetainerCount = {
  readonly count: number;
  readonly selfBytes: number;
  readonly outsideCount: number;
  readonly outsideSelfBytes: number;
  readonly weakOnlyCount: number;
  readonly weakOnlySelfBytes: number;
  readonly outsideAllCount: number;
  readonly outsideAllSelfBytes: number;
  readonly otherSyntheticCount: number;
  readonly otherSyntheticSelfBytes: number;
  readonly outsideSyntheticCount: number;
  readonly outsideSyntheticSelfBytes: number;
};
export type RetainerStep = { readonly node: RetainerNode; readonly edgeType: string | null; readonly edgeName: string | null };
export type WeakPath = { readonly selfBytes: number; readonly truncated: boolean; readonly path: readonly RetainerStep[] };
export type RetainerPath = {
  readonly selfBytes: number;
  readonly retainedBytes: number;
  readonly truncated: boolean;
  readonly dominatorsTruncated: boolean;
  readonly dominators: readonly { readonly node: RetainerNode; readonly selfBytes: number; readonly retainedBytes: number }[];
  readonly path: readonly RetainerStep[];
};
export type RetainerClass = {
  readonly type: string;
  readonly name: string;
  readonly before: RetainerCount;
  readonly after: RetainerCount;
  readonly countDelta: number;
  readonly selfBytesDelta: number;
  readonly pathCount: number;
  readonly examples: readonly RetainerPath[];
  readonly weakExamples: readonly WeakPath[];
};
export type ReferrerCount = { readonly count: number; readonly selfBytes: number };
export type MapWeight = { readonly count: number; readonly hiddenSelfBytes: number };
export type ReachCounts = { readonly count: number; readonly strong: number; readonly weakOnly: number; readonly outsideAll: number };
export type FiberContexts = {
  readonly fibers: ReachCounts;
  readonly fibersWithContext: ReachCounts;
  readonly contexts: ReachCounts;
  readonly contextEdges: number;
  readonly cohortFibers: number;
  readonly cohortContexts: number;
  readonly cohortMaps: MapWeight;
  readonly cohortLinks: { readonly base: number; readonly flat: number };
  readonly exitObjectFibers: number;
  readonly completed: ReachCounts;
  readonly completedReferrers: {
    readonly nonAdditive: true;
    readonly withIncoming: number;
    readonly withoutIncoming: number;
    readonly multipleGroups: number;
    readonly groupCount: number;
    readonly groups: readonly {
      readonly sourceType: string;
      readonly sourceName: string;
      readonly edgeType: string;
      readonly edgeName: string | null;
      readonly count: number;
    }[];
  };
  readonly cachedSpanFibers: number;
  readonly currentCost: {
    readonly scope: 'context-overlay-only';
    readonly observed: ReachCounts;
    readonly notObserved: ReachCounts;
    readonly truncated: number;
    readonly names: readonly { readonly name: string; readonly fibers: ReachCounts }[];
  };
  readonly spanNames: readonly {
    readonly name: string;
    readonly fibers: ReachCounts;
    readonly completed: ReachCounts;
    readonly completedWithoutIncoming: ReachCounts;
  }[];
};
export type MapKeys = {
  readonly nonAdditive: true;
  readonly entryEncoding: 'unverified';
  readonly uninspectableMaps: MapWeight;
  readonly adjacentKnownKeys: readonly { readonly key: string; readonly count: number; readonly hiddenSelfBytes: number }[];
  readonly layout: readonly {
    readonly source: 'map' | 'backing';
    readonly edgeType: string;
    readonly targetType: string;
    readonly role: 'keyLike' | 'valueLike' | 'other';
    readonly count: number;
  }[];
};
export type MapReferences = {
  readonly nonAdditiveGroups: true;
  readonly fibers: FiberContexts;
  readonly keys: MapKeys;
  readonly maps: MapWeight;
  readonly weakOnly: MapWeight;
  readonly outsideAll: MapWeight;
  readonly withIncoming: MapWeight;
  readonly withoutIncoming: MapWeight;
  readonly multipleGroups: MapWeight;
  readonly sharedTargets: ReferrerCount;
  readonly groupCount: number;
  readonly groups: readonly {
    readonly sourceType: string;
    readonly sourceName: string;
    readonly edgeType: string;
    readonly edgeName: string | null;
    readonly count: number;
    readonly hiddenSelfBytes: number;
  }[];
  readonly largest: readonly {
    readonly node: RetainerNode;
    readonly hiddenSelfBytes: number;
    readonly incomingCount: number;
    readonly reverse: readonly { readonly source: RetainerNode; readonly edgeType: string; readonly edgeName: string | null }[];
    readonly stop: 'snapshot-root' | 'no-new-incoming' | 'limit';
  }[];
};
export type HiddenReferences = {
  readonly nonAdditiveGroups: true;
  readonly mapReferrers: MapReferences;
  readonly targets: ReferrerCount;
  readonly withIncoming: ReferrerCount;
  readonly withoutIncoming: ReferrerCount;
  readonly multipleGroups: ReferrerCount;
  readonly groupCount: number;
  readonly groups: readonly {
    readonly sourceType: string;
    readonly sourceName: string;
    readonly edgeType: string;
    readonly count: number;
    readonly selfBytes: number;
  }[];
  readonly largest: readonly {
    readonly node: RetainerNode;
    readonly selfBytes: number;
    readonly incomingCount: number;
    readonly incoming: readonly { readonly source: RetainerNode; readonly edgeType: string; readonly edgeName: string | null }[];
  }[];
};
export type RetainerComparison = {
  readonly nonAdditiveRetainedBytes: true;
  readonly dominatorsOn: 'unfiltered-strong-graph';
  readonly weakEdgesProveRetention: false;
  readonly weakPathsOn: 'unfiltered-graph';
  readonly syntheticNodesProveRoots: false;
  readonly otherSyntheticSeeds: { readonly before: number; readonly after: number };
  readonly outsideHidden: { readonly before: HiddenReferences; readonly after: HiddenReferences };
  readonly before: RetainerCount;
  readonly after: RetainerCount;
  readonly pathWalk: {
    readonly reachable: number;
    readonly excludedEdges: number;
    readonly excludedLabels: readonly string[];
    readonly excludedNodes: readonly number[];
  };
  readonly bySize: readonly RetainerClass[];
  readonly byCount: readonly RetainerClass[];
  readonly decreasedBySize: readonly RetainerClass[];
  readonly decreasedByCount: readonly RetainerClass[];
};
export type RetainerOptions = {
  readonly limit: number;
  readonly labels?: readonly string[];
  readonly operations?: readonly string[];
  readonly excludeLabels?: readonly string[];
  readonly excludeNodes?: readonly number[];
  readonly signal?: AbortSignal;
};

export type RetainerRequest =
  | { readonly mode: 'single'; readonly file: string; readonly limit: number }
  | {
      readonly mode: 'compare';
      readonly before: string;
      readonly after: string;
      readonly limit: number;
      readonly labels: readonly string[];
      readonly operations: readonly string[];
      readonly excludeLabels: readonly string[];
      readonly excludeNodes: readonly number[];
    };
type Answer<T> = { readonly ok: true; readonly summary: T } | { readonly ok: false };

function runWorker<T>(request: RetainerRequest, signal?: AbortSignal): Promise<T> {
  const aborted = () => new DOMException('heap retainer analysis aborted', 'AbortError');
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./loadRetainers.worker.ts', import.meta.url), { workerData: request });
    let settled = false;
    const finish = (answer: Answer<T> | 'aborted') => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      worker.terminate().then(
        () => {
          if (answer === 'aborted') reject(aborted());
          else if (answer.ok) resolve(answer.summary);
          else reject(new Error('heap retainer analysis failed'));
        },
        () => reject(new Error('heap retainer worker termination failed')),
      );
    };
    const onAbort = () => finish('aborted');
    worker.once('message', finish);
    worker.once('error', () => finish({ ok: false }));
    worker.once('exit', () => finish({ ok: false }));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export function loadRetainers(file: string, limit: number, signal?: AbortSignal): Promise<RetainerSummary> {
  if (!Number.isSafeInteger(limit) || limit < 1) return Promise.reject(new Error('retainer limit must be a positive integer'));
  return runWorker({ mode: 'single', file, limit }, signal);
}

export function compareRetainers(before: string, after: string, options: RetainerOptions): Promise<RetainerComparison> {
  const { limit, labels = [], operations = [], excludeLabels = [], excludeNodes = [], signal } = options;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    return Promise.reject(new Error('comparison limit must be between 1 and 100'));
  if ([labels, excludeLabels].some((list) => list.length > 100 || list.some((label) => !/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(label))))
    return Promise.reject(new Error('edge labels must be structural identifiers'));
  if (operations.length > 10000 || operations.some((name) => !/^[A-Za-z][A-Za-z0-9._:/-]{0,127}$/.test(name)))
    return Promise.reject(new Error('operation names must be approved identifiers'));
  if (excludeNodes.length > 100 || excludeNodes.some((index) => !Number.isSafeInteger(index) || index < 1))
    return Promise.reject(new Error('excluded nodes must be positive snapshot indexes'));
  return runWorker({ mode: 'compare', before, after, limit, labels, operations, excludeLabels, excludeNodes }, signal);
}

if (import.meta.main) {
  const [before, after, ...args] = process.argv.slice(2);
  if (before === undefined || after === undefined)
    throw new Error(
      'usage: bun loadRetainers.ts BEFORE AFTER [--limit=N] [--label=NAME] [--operation=NAME] [--exclude-label=NAME] [--exclude-node=INDEX] [--output=FILE]',
    );
  const flag = (prefix: string) => args.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length));
  const result = await compareRetainers(before, after, {
    limit: Number(flag('--limit=')[0] ?? 20),
    labels: flag('--label='),
    operations: flag('--operation='),
    excludeLabels: flag('--exclude-label='),
    excludeNodes: flag('--exclude-node=').map(Number),
  });
  const output = flag('--output=')[0];
  const json = JSON.stringify(result, null, 2);
  if (output === undefined) console.log(json);
  else await Bun.write(output, json);
}
