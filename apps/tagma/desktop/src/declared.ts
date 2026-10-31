import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import type { WindowDeclaration, WindowDocument, WindowProcess, WindowProcessKind } from '@tagma/server/executions/contract/wire/load';

export const creationPrecisionMs = (platform: string): number => (platform === 'darwin' ? 10 : 1_000);

export type Metric = { readonly pid: number; readonly type: string; readonly creationTime: number };

export type Role = { readonly kind: 'interface' } | { readonly kind: 'page'; readonly page: PageId } | { readonly kind: 'other' };

export type Frame = { readonly pid: number; readonly origin: string; readonly main: boolean };

export type Hosted = { readonly role: Role; readonly frames: readonly Frame[] };

const KINDS: Readonly<Record<string, WindowProcessKind>> = { Browser: 'main', GPU: 'graphics', Tab: 'renderer' };

const originDocument = (origin: string): WindowDocument | null => (origin === '' || origin === 'null' ? null : { _tag: 'Origin', origin });

const frameDocument = (role: Role, frame: Frame): WindowDocument | null => {
  if (!frame.main || role.kind === 'other') return originDocument(frame.origin);
  return role.kind === 'interface' ? { _tag: 'Interface' } : { _tag: 'Page', page: role.page };
};

const documentsByProcess = (hosted: readonly Hosted[]): ReadonlyMap<number, ReadonlyMap<string, WindowDocument>> => {
  const byProcess = new Map<number, Map<string, WindowDocument>>();
  for (const { role, frames } of hosted) {
    const root = frames.find((frame) => frame.main);
    for (const frame of frames) {
      if (frame.pid <= 0) continue;
      if (!frame.main && root !== undefined && frame.pid === root.pid && frame.origin === root.origin) continue;
      const document = frameDocument(role, frame);
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
