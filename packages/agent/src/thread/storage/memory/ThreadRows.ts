import { Effect } from 'effect';
import { uuidv7 } from 'uuidv7';
import { utf8ByteLength } from '@runlith/utils/utf8';
import { attempt } from './attempt';
import { THREAD_AUTHORITY_DEFAULT, type ThreadMetadataRow, type ThreadRow } from '../../rows';
import { openQuestionsIn } from '../../../transcript/questions';
import { toolSettled, type ThreadQuestionEntry, type ThreadToolEntry } from '../../../transcript/entries';
import { coreEntry } from '../../../transcript/kinds';
import { WIRE_ENTRY_MAX_BYTES } from '../../../transcript/cap';
import { ThreadStorageFailed } from '../../persisted';
import { NATIVE_BINDING, NATIVE_CAPABILITIES } from '../../record';
import { branchedFrom, ThreadNotFoundError, type ThreadAggregateStorage, type ThreadInsertValues } from '../aggregate';
import { applyColumns, headOf, historyOf, project, transcriptOf } from './folds';
import type { HeldThread, MemoryStorageInput } from './state';
import type { MemoryTx } from './units';

type ThreadBirth = ThreadInsertValues & {
  readonly id: string;
  readonly spawnRootId: string;
  readonly cacheGroup: string;
  readonly authority: ThreadRow['authority'];
};

export const makeMemoryRows = ({ memory }: MemoryStorageInput): ThreadAggregateStorage<MemoryTx> => {
  const rowOf = (held: HeldThread): ThreadRow => ({
    ...held.row,
    history: historyOf(memory.kinds, held),
    systemPrompt: held.systemPrompt,
    pendingSystemPrompt: held.pendingSystemPrompt,
  });
  const rows = (tx: MemoryTx | undefined, keep: (row: ThreadMetadataRow) => boolean): readonly ThreadMetadataRow[] =>
    memory.read(tx, () => [...memory.threads.values()].filter(({ row }) => keep(row)).map(({ row }) => row));
  const descendantsOf = (roots: readonly string[]): ReadonlySet<string> => {
    const children = new Map<string, string[]>();
    for (const { row } of memory.threads.values()) {
      if (row.parentThreadId === null) continue;
      const family = children.get(row.parentThreadId);
      if (family) family.push(row.id);
      else children.set(row.parentThreadId, [row.id]);
    }
    const inside = new Set<string>();
    const pending = [...roots].reverse();
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (inside.has(id)) continue;
      inside.add(id);
      const family = children.get(id) ?? [];
      for (let at = family.length - 1; at >= 0; at -= 1) pending.push(family[at]!);
    }
    return inside;
  };
  const subtree = (tx: MemoryTx | undefined, ownerId: string, threadId: string): readonly ThreadMetadataRow[] =>
    memory.read(tx, () => {
      const inside = descendantsOf([threadId]);
      return rows(tx, (row) => row.ownerId === ownerId && inside.has(row.id));
    });
  const born = (tx: MemoryTx, values: ThreadBirth): ThreadRow => {
    if (memory.threads.has(values.id)) throw new Error(`Thread ${values.id} already exists.`);
    const name = values.name ?? null;
    if (name !== null) {
      for (const { row } of memory.threads.values()) {
        if (row.spawnRootId === values.spawnRootId && row.name === name) {
          throw new Error(`The name ${name} is already a live address inside spawn root ${values.spawnRootId}.`);
        }
      }
    }
    const at = tx.now();
    const held: HeldThread = {
      row: {
        id: values.id,
        ownerId: values.ownerId,
        agentId: values.agentId,
        parentThreadId: values.parentThreadId ?? null,
        spawnedByRunId: values.spawnedByRunId ?? null,
        bornOf: values.bornOf ?? null,
        spawnRootId: values.spawnRootId,
        cacheGroup: values.cacheGroup,
        name,
        budgetTokens: values.budgetTokens ?? null,
        profile: values.profile ?? null,
        authority: values.authority,
        plain: values.plain ?? false,
        hostKind: values.hostKind ?? null,
        hostId: values.hostId ?? null,
        bindings: values.bindings ?? {},
        pendingInteraction: values.pendingInteraction ?? null,
        account: values.account ?? null,
        provider: values.provider ?? 'test-provider',
        model: values.model ?? null,
        reasoning: values.reasoning ?? null,
        switches: values.switches ?? {},
        transport: values.transport ?? NATIVE_BINDING,
        capabilities: values.capabilities ?? NATIVE_CAPABILITIES,
        status: values.status ?? 'idle',
        failureReason: values.failureReason ?? null,
        contextReading: null,
        createdBy: values.createdBy ?? null,
        createdAt: at,
        updatedAt: at,
      },
      systemPrompt: values.systemPrompt ?? null,
      pendingSystemPrompt: values.pendingSystemPrompt ?? null,
      history: [...(values.history ?? [])],
      historyThrough: 0,
      transcript: [...(values.transcript ?? [])],
      entriesThrough: 0,
      events: [],
      observations: [],
      foldRev: 0,
      inheritRev: 0,
      runningRunId: null,
      ended: [],
      scope: null,
    };
    tx.put(memory.threads, values.id, held);
    return rowOf(held);
  };

  return {
    readCut: (threadId, use) =>
      memory.units.snapshot((tx) => {
        const revision = memory.units.revision(tx);
        const position = memory.read(tx, () => {
          const held = memory.held(threadId);
          return held === undefined ? 0 : headOf(held);
        });
        return use({ tx, revision, position });
      }),
    transaction: (work) => memory.units.commit(work),
    find: (id, tx) =>
      attempt('find', () =>
        memory.read(tx, () => {
          const held = memory.held(id);
          return held && rowOf(held);
        }),
      ),
    findOwned: (id, ownerId, tx) =>
      attempt('findOwned', () =>
        memory.read(tx, () => {
          const held = memory.held(id);
          return held && held.row.ownerId === ownerId ? rowOf(held) : undefined;
        }),
      ),
    metadata: (id, tx) => attempt('metadata', () => memory.read(tx, () => memory.held(id)?.row)),
    metadataOf: (ids, tx) =>
      attempt('metadataOf', () => memory.read(tx, () => [...new Set(ids)].flatMap((id) => memory.held(id)?.row ?? []))),
    systemPromptOf: (id, tx) =>
      attempt('systemPromptOf', () =>
        memory.read(tx, () => {
          const held = memory.held(id);
          return (
            held && {
              systemPrompt: held.systemPrompt,
              pendingSystemPrompt: held.pendingSystemPrompt,
              pendingDefinition: held.row.pendingDefinition,
            }
          );
        }),
      ),
    logs: (id, tx) =>
      attempt('logs', () =>
        memory.read(tx, () => {
          const held = memory.held(id);
          return held ? { history: historyOf(memory.kinds, held), transcript: transcriptOf(memory.kinds, held) } : null;
        }),
      ),
    transcriptOf: (id, tx) =>
      attempt('transcriptOf', () =>
        memory.read(tx, () => {
          const held = memory.held(id);
          return held ? transcriptOf(memory.kinds, held) : null;
        }),
      ),
    historyOf: (id, tx) =>
      attempt('historyOf', () =>
        memory.read(tx, () => {
          const held = memory.held(id);
          return held ? historyOf(memory.kinds, held) : null;
        }),
      ),
    entriesOfRun: (id, runId, tx) =>
      attempt('entriesOfRun', () =>
        memory.read(tx, () => {
          const held = memory.held(id);
          return held ? transcriptOf(memory.kinds, held).filter((entry) => entry.runId === runId) : [];
        }),
      ),
    openToolsOfRun: (id, runId, tx) =>
      attempt('openToolsOfRun', () =>
        memory.read(tx, () => {
          const held = memory.held(id);
          return held === undefined
            ? []
            : transcriptOf(memory.kinds, held).filter(
                (entry): entry is ThreadToolEntry =>
                  entry.runId === runId && coreEntry(entry) && entry.type === 'tool' && !toolSettled(entry.toolState),
              );
        }),
      ),
    openQuestionsOfRun: (id, runId, tx) =>
      attempt('openQuestionsOfRun', () =>
        memory.read(tx, () => {
          const held = memory.held(id);
          return held ? openQuestionsIn(transcriptOf(memory.kinds, held).filter((entry) => entry.runId === runId)) : [];
        }),
      ),
    questionById: (id, questionId, tx) =>
      attempt('questionById', () =>
        memory.read(tx, () => {
          const held = memory.held(id);
          return held === undefined
            ? undefined
            : transcriptOf(memory.kinds, held).findLast(
                (entry): entry is ThreadQuestionEntry & typeof entry =>
                  coreEntry(entry) && entry.type === 'question' && entry.questionId === questionId,
              );
        }),
      ),
    entryById: (id, entryId, tx) =>
      attempt('entryById', () =>
        memory.read(tx, () => {
          const held = memory.held(id);
          return held && transcriptOf(memory.kinds, held).find((entry) => entry.id === entryId);
        }),
      ),
    transcriptWindow: (id, query, tx) =>
      attempt('transcriptWindow', () =>
        memory.read(tx, () => {
          const held = memory.held(id);
          if (!held) return null;
          const entries = transcriptOf(memory.kinds, held);
          const ceiling = query.before ?? entries.length;
          let bytes = 0;
          let floor = ceiling;
          while (floor > 0 && ceiling - floor < query.limit) {
            const entry = entries[floor - 1]!;
            const size = utf8ByteLength(JSON.stringify(entry));
            const weight = entry.type === 'tool' ? Math.min(size, WIRE_ENTRY_MAX_BYTES) : size;
            if (floor < ceiling && bytes + weight > query.bytes) break;
            bytes += weight;
            floor -= 1;
          }
          return { entries: entries.slice(floor, ceiling), before: floor > 0 && floor < ceiling ? floor : null };
        }),
      ),
    insert: (values, tx) => {
      if (values.parentThreadId) {
        return Effect.fail(
          new ThreadStorageFailed({ call: 'insert', cause: new Error('Child threads must be inserted through ThreadStore.insertChild.') }),
        );
      }
      return memory.units.commit(
        (unit) =>
          attempt('insert', () => {
            const id = values.id ?? uuidv7();
            return born(unit, {
              ...values,
              id,
              parentThreadId: null,
              spawnRootId: id,
              cacheGroup: values.cacheGroup ?? id,
              authority: values.authority ?? THREAD_AUTHORITY_DEFAULT,
            });
          }),
        tx,
      );
    },
    insertChild: (parentThreadId, values, tx) =>
      attempt('insertChild', () => {
        const parent = memory.held(parentThreadId);
        if (!parent) throw new ThreadNotFoundError(parentThreadId);
        const child = born(tx, {
          ...values,
          id: values.id ?? uuidv7(),
          parentThreadId,
          spawnRootId: parent.row.spawnRootId,
          cacheGroup: values.cacheGroup ?? parent.row.cacheGroup,
          authority: values.authority ?? parent.row.authority,
        });
        const held = memory.held(child.id);
        if (held) held.scope = parent.scope;
        return child;
      }),
    update: (id, patch, tx) => {
      if (Object.keys(patch).length === 0) return Effect.void;
      return memory.units.commit(
        (unit) =>
          attempt('update', () => {
            const held = memory.held(id);
            if (!held) return;
            const fixed = ['parentThreadId', 'spawnedByRunId', 'createdBy'].filter(
              (key) => (patch as Record<string, unknown>)[key] !== undefined,
            );
            if (fixed.length > 0) throw new Error(`Thread ${id}: a patch cannot move its record's ${fixed.join(', ')}.`);
            unit.keep(held);
            applyColumns(held, patch, unit.now());
          }),
        tx,
      );
    },
    appendEntries: (id, input) => {
      const history = input.history ?? [];
      const transcript = input.transcript ?? [];
      if (history.length === 0 && transcript.length === 0) return Effect.void;
      return memory.units.commit((unit) =>
        attempt('appendEntries', () => {
          const held = memory.held(id);
          if (!held) return;
          unit.keep(held);
          project(memory.kinds, held);
          const standing = held.events[held.events.length - 1]?.position ?? 0;
          if (history.length > 0) {
            held.history = [...historyOf(memory.kinds, held), ...history];
            held.historyThrough = standing;
          }
          held.transcript = [...held.transcript, ...transcript];
          held.row = { ...held.row, updatedAt: unit.now() };
        }),
      );
    },
    branch: (seed, tx) =>
      attempt('branch', () => {
        const source = memory.held(seed.sourceId);
        if (!source) throw new ThreadNotFoundError(seed.sourceId);
        const child = memory.held(seed.childId);
        if (!child) throw new ThreadNotFoundError(seed.childId);
        tx.keep(child);
        if (seed.entries.kind === 'none') return { through: 0, from: null };
        const transcript = transcriptOf(memory.kinds, source);
        const history = historyOf(memory.kinds, source);
        child.events = source.events.map((event) => ({ ...event, threadId: seed.childId, id: `${seed.childId}:${event.position}` }));
        for (const event of child.events) tx.put(memory.eventIds, event.id, seed.childId);
        const through = child.events[child.events.length - 1]?.position ?? 0;
        child.transcript = [...transcript];
        child.history = [...history];
        child.entriesThrough = through;
        child.historyThrough = through;
        child.foldRev += 1;
        return { through, from: branchedFrom(transcript, seed.entries) };
      }),
    delete: (ids, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('delete', () => {
            const gone = descendantsOf(ids.filter((id) => memory.threads.has(id)));
            for (const [runId, run] of memory.runs) if (gone.has(run.threadId)) unit.remove(memory.runs, runId);
            for (const id of gone) {
              for (const event of memory.held(id)?.events ?? []) unit.remove(memory.eventIds, event.id);
              unit.remove(memory.threads, id);
            }
            memory.remove(gone, unit);
          }),
        tx,
      ),
    pageTeam: (ask, tx) =>
      attempt('pageTeam', () =>
        memory.read(tx, () => {
          const going = new Set<string>();
          for (const run of memory.runs.values()) if (run.status === 'running') going.add(run.threadId);
          const team = [...memory.threads.values()]
            .map((held) => held.row)
            .filter(
              (row) =>
                row.spawnRootId === ask.spawnRootId &&
                row.ownerId === ask.ownerId &&
                (ask.parent === undefined || row.parentThreadId === ask.parent),
            );
          const after = ask.after;
          const rows = team
            .filter((row) => going.has(row.id) === (ask.within === 'running'))
            .filter(
              (row) =>
                after === undefined ||
                row.updatedAt.getTime() < after.movedAt.getTime() ||
                (row.updatedAt.getTime() === after.movedAt.getTime() && row.id < after.id),
            )
            .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || (left.id < right.id ? 1 : -1))
            .slice(0, ask.limit);
          return { rows, total: team.length };
        }),
      ),
    findNamed: (spawnRootId, ownerId, name, tx) =>
      attempt('findNamed', () =>
        memory.read(tx, () => {
          const held = [...memory.threads.values()].find(
            ({ row }) => row.spawnRootId === spawnRootId && row.ownerId === ownerId && row.name === name,
          );
          return held && rowOf(held);
        }),
      ),
    listByHost: (ownerId, hostKind, hostId, tx) =>
      attempt('listByHost', () => rows(tx, (row) => row.ownerId === ownerId && row.hostKind === hostKind && row.hostId === hostId)),
    listByParent: (ownerId, parentThreadId, tx) =>
      attempt('listByParent', () => rows(tx, (row) => row.ownerId === ownerId && row.parentThreadId === parentThreadId)),
    listSubtree: (ownerId, threadId) => attempt('listSubtree', () => subtree(undefined, ownerId, threadId)),
    holdSubtree: (ownerId, threadId, tx) => attempt('holdSubtree', () => subtree(tx, ownerId, threadId)),
  };
};
