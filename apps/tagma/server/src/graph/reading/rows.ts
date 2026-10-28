import type { SourceRow, BlockRecord, BlockWrite } from '../contract/service/acts.js';
import type { ProjectPolicyRow } from '../contract/wire/serving.js';
import { blockName } from '../contract/wire/references.js';

import type { ActEntry } from '../contract/service/acts.js';
import type { JournalEvent } from '../contract/wire/journal.js';
import type { BlockDetail, DetailEdge } from '../contract/service/reads.js';
import { displacedAt, type ServesFrom } from '../contract/wire/storage.js';
import type { Source, Block, BlockRead, Edge, Project, TreeBlock, WrittenBlock } from '../contract/wire/rows.js';

const at = (value: Date): string => value.toISOString();
const maybeAt = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export function wireProject(row: ProjectPolicyRow, servesFrom: ServesFrom): Project {
  return {
    id: row.id,
    name: row.name,
    repoKey: row.repoKey,
    rootPath: row.rootPath,
    strictProvenance: row.strictProvenance,
    private: row.private,
    global: row.global,
    storage: row.storage,
    graphRemote: row.graphRemote,
    servesFrom,
    createdAt: at(row.createdAt),
  };
}

export function wireBlock(row: BlockRecord): Block {
  return { ...wireTreeBlock(row), body: row.body };
}

export function wireTreeBlock(row: Omit<BlockRecord, 'body'>): TreeBlock {
  const parentUuid = (row as { parentUuid?: string | null }).parentUuid ?? null;
  return {
    name: blockName(row.uuid),
    projectId: row.projectId,
    parentName: row.parentId === null ? null : blockName(parentUuid ?? ''),
    ord: row.ord,
    tags: row.tags,
    fields: row.fields,
    actions: row.actions,
    title: row.title,
    superseded: row.superseded,
    blocked: row.blocked,
    building: row.building,
    answered: row.answered,
    stealth: row.stealth ? true : undefined,
    displaced: row.stealth && row.path !== null && displacedAt(row.path, parentUuid) ? true : undefined,
    deletedAt: maybeAt(row.deletedAt),
    createdAt: at(row.createdAt),
    updatedAt: at(row.updatedAt),
  };
}

export function wireEdge(row: DetailEdge): Edge {
  return {
    fromName: blockName(row.fromUuid ?? ''),
    toName: blockName(row.toUuid ?? ''),
    kind: row.kind,
    createdBySessionId: row.createdBySessionId,
    createdAt: at(row.createdAt),
    graph: row.far,
  };
}

export function wireSource(row: SourceRow): Source {
  return {
    id: row.id,
    kind: row.kind,
    ref: row.ref,
    symbol: row.symbol,
    createdAt: at(row.createdAt),
  };
}

export function wireEvent(row: ActEntry, blockUuid?: string | null): JournalEvent & { op: ActEntry['op'] } {
  return {
    id: row.id,
    ts: at(row.ts),
    sessionId: row.sessionId,
    op: row.op,
    blockName: row.blockId === null ? null : blockName(blockUuid ?? ''),
    payload: row.payload,
  };
}

export function wireRead(row: BlockDetail): BlockRead {
  return {
    ...wireBlock(row),
    edgesOut: row.edgesOut.map(wireEdge),
    edgesIn: row.edgesIn.map(wireEdge),
    edgesInUnread: row.edgesInUnread.length === 0 ? undefined : row.edgesInUnread,
    refsOut: row.refsOut,
    refsElsewhere: row.refsElsewhere.length === 0 ? undefined : row.refsElsewhere,
    refsAbsent: row.refsAbsent.length === 0 ? undefined : row.refsAbsent,
    refsIn: row.refsIn,
    restingIn: { edges: row.restingIn.edges.map(wireEdge), refs: row.restingIn.refs },
    sources: row.sources.map(wireSource),
    reach: row.reach,
    verdict: row.verdict === null ? null : { ...row.verdict, at: at(row.verdict.at) },
    ending: row.ending === null ? null : { ...row.ending, at: at(row.ending.at) },
    author: row.author,
    answeredBy: row.answeredBy,
    answeredCommit: row.answeredCommit,
    answeredCheck: row.answeredCheck,
    results: row.results,
    shape: row.shape,
    children: row.children.map(wireRead),
  };
}

export function wireWritten(row: BlockRecord & Partial<BlockWrite>): WrittenBlock {
  return {
    ...wireBlock(row),
    refsIn: row.refsIn,
  };
}
