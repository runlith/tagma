import { and, asc, eq, isNull } from 'drizzle-orm';
import { type Context, Effect } from 'effect';
import { commandRule } from './commandRule.js';
import type { MachineStore } from '../../platform/contract/service/store.js';
import type { CommandRule } from '../contract/wire/commandRules.js';

type Machine = Context.Service.Shape<typeof MachineStore>;

export type PlacedRule = { readonly rule: CommandRule; readonly position: number };

export type Row = typeof commandRule.$inferSelect;

export const ruleOf = (row: Row): CommandRule => ({
  id: row.id,
  project: row.projectId,
  thread: row.threadId,
  through: row.through,
  program: row.program ?? null,
  measure: row.measure,
  limitMs: row.limitMs,
  origin: { writer: row.writer, at: row.writtenAt.toISOString(), words: row.words },
});

export const placed = (row: Row): PlacedRule => ({ rule: ruleOf(row), position: row.position });

export type ListOf = { readonly projectId: number | null; readonly thread: string | null };

export const listed = (machine: Machine, list: ListOf) =>
  Effect.map(
    machine.db
      .select()
      .from(commandRule)
      .where(
        and(
          list.projectId === null ? isNull(commandRule.projectId) : eq(commandRule.projectId, list.projectId),
          list.thread === null ? isNull(commandRule.threadId) : eq(commandRule.threadId, list.thread),
        ),
      )
      .orderBy(asc(commandRule.position), asc(commandRule.id)),
    (rows) => rows.map(placed),
  );

export const currentRules = Effect.fn('commandRules.current')(function* (
  machine: Machine,
  projectId: number | null,
  thread: string | null,
  home: number | null = projectId,
) {
  const lists: ListOf[] = [
    { projectId: null, thread: null },
    ...(projectId === null ? [] : [{ projectId, thread: null }]),
    ...(home === null || thread === null ? [] : [{ projectId: home, thread }]),
  ];
  return (yield* Effect.forEach(lists, (list) => listed(machine, list))).flat();
});
