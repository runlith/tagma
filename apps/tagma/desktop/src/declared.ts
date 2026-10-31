import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import type { WindowDeclaration, WindowDocument, WindowProcess, WindowProcessKind } from '@tagma/server/executions/contract/wire/load';
import { viewOfFrameName } from '@tagma/server/executions/contract/wire/viewName';

export const creationPrecisionMs = (platform: string): number => (platform === 'darwin' ? 10 : 1_000);

export type Metric = { readonly pid: number; readonly type: string; readonly creationTime: number };

export type Role = { readonly kind: 'interface' } | { readonly kind: 'page'; readonly page: PageId } | { readonly kind: 'other' };

export type Frame = {
  readonly id: number;
  readonly parent: number | null;
  readonly pid: number;
  readonly origin: string;
  readonly name: string;
};

export type Hosted = { readonly role: Role; readonly frames: readonly Frame[] };

const KINDS: Readonly<Record<string, WindowProcessKind>> = { Browser: 'main', GPU: 'graphics', Tab: 'renderer' };

const originDocument = (origin: string): WindowDocument | null => (origin === '' || origin === 'null' ? null : { _tag: 'Origin', origin });

const documentOf = ({ role, frames }: Hosted, frame: Frame, byId: ReadonlyMap<number, Frame>): WindowDocument | null => {
  if (role.kind === 'page') return { _tag: 'Page', page: role.page };
  if (role.kind === 'other') return originDocument(frame.origin);
  for (let at: Frame | undefined = frame; at !== undefined; at = at.parent === null ? undefined : byId.get(at.parent)) {
    const view = viewOfFrameName(at.name);
    if (view !== undefined) return view;
  }
  const root = frames.find((one) => one.parent === null);
  if (frame.parent === null) return { _tag: 'Interface' };
  if (root !== undefined && frame.pid === root.pid && frame.origin === root.origin) return null;
  return originDocument(frame.origin);
};

const documentsByProcess = (hosted: readonly Hosted[]): ReadonlyMap<number, ReadonlyMap<string, WindowDocument>> => {
  const byProcess = new Map<number, Map<string, WindowDocument>>();
  for (const one of hosted) {
    const byId = new Map(one.frames.map((frame) => [frame.id, frame]));
    for (const frame of one.frames) {
      if (frame.pid <= 0) continue;
      const document = documentOf(one, frame, byId);
      if (document === null) continue;
      const standing = byProcess.get(frame.pid) ?? new Map<string, WindowDocument>();
      standing.set(JSON.stringify(document), document);
      byProcess.set(frame.pid, standing);
    }
  }
  return byProcess;
};

export const declared = (metrics: readonly Metric[], hosted: readonly Hosted[], precisionMs: number): WindowDeclaration => {
  const documents = documentsByProcess(hosted);
  const processes: WindowProcess[] = [];
  for (const metric of metrics) {
    const createdMs = Math.round(metric.creationTime);
    if (metric.pid <= 0 || createdMs <= 0) continue;
    const kind = KINDS[metric.type] ?? 'utility';
    const standing = kind === 'renderer' ? [...(documents.get(metric.pid)?.entries() ?? [])].sort(([a], [b]) => (a < b ? -1 : 1)) : [];
    processes.push({ pid: metric.pid, createdMs, kind, documents: standing.map(([, document]) => document) });
  }
  processes.sort((one, other) => one.pid - other.pid);
  return { precisionMs, processes };
};
