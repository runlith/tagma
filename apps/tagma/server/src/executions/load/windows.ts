import type { DeclaredPart } from '@runlith/executions/protocol/evidence';
import { Effect, SubscriptionRef } from 'effect';
import type { Pages } from '../../browser/contract/service/pages.js';
import type { PageId } from '../../browser/contract/wire/ids.js';
import { type AppRef, WindowDeclarations, type WindowPart } from '../contract/service/load.js';
import type { LoadPage, WindowDeclaration, WindowDocument, WindowProcess } from '../contract/wire/load.js';
import { type AppTitles, appTitleKey } from './work.js';

export type PartRow =
  | { readonly _tag: 'Interface' }
  | { readonly _tag: 'Graphics' }
  | { readonly _tag: 'Renderer'; readonly titles: readonly string[]; readonly close: readonly LoadPage[] };

export type PartLookup = (key: string) => PartRow | undefined;

export type PartNames = {
  readonly row: (key: string, titles: AppTitles) => PartRow | undefined;
  readonly apps: () => readonly AppRef[];
};

const keyOf = (host: string, process: WindowProcess): string => `window:${host}:${process.pid}:${process.createdMs}`;

const hostOf = (url: string): string | undefined => {
  if (!URL.canParse(url)) return undefined;
  const host = new URL(url).host;
  return host === '' ? undefined : host;
};

const documentTitle = (document: WindowDocument, pages: Pages['Service'], titles: AppTitles): string => {
  switch (document._tag) {
    case 'Interface':
      return 'Interface';
    case 'Page': {
      const glance = pages.glance(document.page, false);
      const host = hostOf(glance.url);
      const title = glance.title.trim();
      if (title === '') return host === undefined ? 'Page' : `Page — ${host}`;
      return host === undefined ? `Page — ${title}` : `Page — ${title} (${host})`;
    }
    case 'AppView':
      return `App — ${titles.get(appTitleKey(document)) ?? document.app}`;
    case 'McpView':
      return `MCP view — ${document.server}`;
    case 'Origin':
      return document.origin;
  }
};

const partRow = (part: WindowPart, pages: Pages['Service'], titles: AppTitles): PartRow => {
  const { kind, documents } = part.process;
  if (kind === 'graphics') return { _tag: 'Graphics' };
  if (kind !== 'renderer' || documents.length === 0 || documents.some((one) => one._tag === 'Interface')) return { _tag: 'Interface' };
  return {
    _tag: 'Renderer',
    titles: [...new Set(documents.map((one) => documentTitle(one, pages, titles)))],
    close: documents.flatMap((one) => (one._tag === 'Page' ? closable(one.page, pages) : [])),
  };
};

const closable = (page: PageId, pages: Pages['Service']): readonly LoadPage[] => {
  const profile = pages.profileOf(page);
  const record = profile === undefined ? undefined : pages.inProfile(profile).find((one) => one.id === page);
  return record === undefined ? [] : [{ page, projectId: record.projectId }];
};

export const partNames = (windows: WindowDeclarations['Service'], pages: Pages['Service']): PartNames => ({
  row: (key, titles) => {
    const part = windows.part(key);
    return part === undefined ? undefined : partRow(part, pages, titles);
  },
  apps: () => windows.views(),
});

export const makeWindowDeclarations = Effect.gen(function* () {
  const held = new Map<string, { readonly generation: number; readonly declaration: WindowDeclaration }>();
  let byKey: ReadonlyMap<string, WindowPart> = new Map();
  let appViews: readonly AppRef[] = [];
  const parts = yield* SubscriptionRef.make<readonly DeclaredPart[]>([]);

  const publish = Effect.suspend(() => {
    const next = new Map<string, WindowPart>();
    const declared: DeclaredPart[] = [];
    const apps = new Map<string, AppRef>();
    for (const [host, { declaration }] of held)
      for (const process of declaration.processes) {
        const key = keyOf(host, process);
        if (next.has(key)) continue;
        next.set(key, { host, process });
        declared.push({ key, pid: process.pid, createdMs: process.createdMs, precisionMs: declaration.precisionMs });
        for (const document of process.documents)
          if (document._tag === 'AppView') apps.set(appTitleKey(document), { project: document.project, app: document.app });
      }
    byKey = next;
    appViews = [...apps.values()];
    return SubscriptionRef.set(parts, declared);
  });

  return WindowDeclarations.of({
    declare: (host, generation, declaration) =>
      Effect.suspend(() => {
        const standing = held.get(host);
        if (standing !== undefined && standing.generation > generation) return Effect.void;
        held.set(host, { generation, declaration });
        return publish;
      }),
    end: (host, generation) =>
      Effect.suspend(() => {
        if (held.get(host)?.generation !== generation) return Effect.void;
        held.delete(host);
        return publish;
      }),
    parts: SubscriptionRef.changes(parts),
    declared: SubscriptionRef.get(parts),
    part: (key) => byKey.get(key),
    views: () => appViews,
  });
});
