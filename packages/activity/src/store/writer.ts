import { sql, type SQL } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { Effect, type Latch } from 'effect';
import type { ActivityEnded, ActivityFact, ActivityNoted, ActivityOpened, RunTarget } from '../fact';
import { MODEL_CALL, type ModelCallAttrs, type ModelCallUsage } from '../modelCall';
import type { ActivityBodyState } from './record';
import type { ActivityCost } from '../log';
import { canonical, folded, metadata, METADATA_BYTES } from './document';

export type BodyForm = 'value' | 'full' | 'delta';

export type BodyStored = {
  readonly _tag: 'BodyStored';
  readonly activity: string;
  readonly n: number;
  readonly kind: string;
  readonly at: number;
  readonly bucket: string;
  readonly bytes: number;
  readonly size: number;
  readonly contentType: string;
  readonly state: ActivityBodyState;
  readonly form: BodyForm;
  readonly base: string | null;
};

export type BodySlot = {
  readonly commit: (body: BodyStored) => void;
  readonly cancel: () => void;
};

export type Lost = {
  readonly _tag: 'Lost';
  readonly cause: string;
  readonly at: number;
  readonly until?: number;
  readonly unknown?: boolean;
  readonly facts: number;
  readonly bodies: number;
  readonly bytes: number;
};

export type Pending = Exclude<ActivityFact, { readonly _tag: 'Bodied' }> | BodyStored | Lost;

export type Batch = {
  readonly cost: ActivityCost | undefined;
  readonly opened: readonly ActivityOpened[];
  readonly noted: readonly ActivityNoted[];
  readonly ended: readonly ActivityEnded[];
  readonly stored: readonly BodyStored[];
  readonly lost: readonly Lost[];
  readonly facts: number;
  readonly since: number | null;
  readonly until: number | null;
};

const ROWS_PER_STATEMENT = 400;
const DOCUMENTS_PER_STATEMENT = 512 * 1024;

export class Writer {
  private pending: Pending[] = [];
  private pendingCost: ActivityCost | undefined;
  private reserved = 0;
  private accepting = true;
  private losses = new Map<string, Lost>();
  private dropped = 0;
  private droppedSince = Number.POSITIVE_INFINITY;
  private droppedUntil = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly wake: Latch.Latch,
    private readonly ceiling: number,
    private readonly captureCost?: () => ActivityCost,
  ) {}

  close(): void {
    this.accepting = false;
  }

  reserveBody(): BodySlot | null {
    if (!this.accepting) return null;
    if (this.pending.length + this.reserved >= this.ceiling) return null;
    this.reserved += 1;
    const cost = this.captureCost?.();
    return {
      commit: (body) => {
        this.reserved -= 1;
        this.pendingCost ??= cost;
        this.pending.push(body);
        this.wake.openUnsafe();
      },
      cancel: () => {
        this.reserved -= 1;
      },
    };
  }

  push(item: Pending): void {
    if (item._tag === 'Lost') {
      this.pendingCost ??= this.captureCost?.();
      const held = this.losses.get(item.cause);
      this.losses.set(
        item.cause,
        held === undefined
          ? item
          : {
              ...held,
              at: Math.min(held.at, item.at),
              until: Math.max(held.until ?? held.at, item.until ?? item.at),
              unknown: held.unknown === true || item.unknown === true,
              facts: held.facts + item.facts,
              bodies: held.bodies + item.bodies,
              bytes: held.bytes + item.bytes,
            },
      );
      this.wake.openUnsafe();
      return;
    }
    if (!this.accepting) {
      this.push({ _tag: 'Lost', cause: 'unwritten', at: item.at, facts: 1, bodies: 0, bytes: 0 });
      return;
    }
    if (this.pending.length + this.reserved >= this.ceiling) {
      this.dropped += 1;
      this.droppedSince = Math.min(this.droppedSince, item.at);
      this.droppedUntil = Math.max(this.droppedUntil, item.at);
      return;
    }
    this.pendingCost ??= this.captureCost?.();
    this.pending.push(item);
    this.wake.openUnsafe();
  }

  waiting(): boolean {
    return this.pending.length > 0 || this.dropped > 0 || this.losses.size > 0;
  }

  counts(): { readonly pending: number; readonly dropped: number } {
    return { pending: this.pending.length + this.losses.size, dropped: this.dropped };
  }

  unwritten(): number {
    let count = this.dropped;
    for (const item of this.losses.values()) count += item.facts + item.bodies;
    for (const item of this.pending) count += item._tag === 'Lost' ? item.facts + item.bodies : 1;
    return count;
  }

  take(): Batch {
    const items = this.pending;
    this.pending = [];
    const cost = this.pendingCost;
    this.pendingCost = undefined;
    const opened: ActivityOpened[] = [];
    const noted: ActivityNoted[] = [];
    const ended: ActivityEnded[] = [];
    const stored: BodyStored[] = [];
    const lost: Lost[] = [...this.losses.values()];
    this.losses.clear();
    let since = Number.POSITIVE_INFINITY;
    let until = Number.NEGATIVE_INFINITY;
    for (const item of items) {
      since = Math.min(since, item.at);
      until = Math.max(until, item.at);
      switch (item._tag) {
        case 'Opened':
          opened.push(item);
          break;
        case 'Noted':
          noted.push(item);
          break;
        case 'Ended':
          ended.push(item);
          break;
        case 'BodyStored':
          stored.push(item);
          break;
        case 'Lost':
          lost.push(item);
          break;
      }
    }
    if (this.dropped > 0) {
      lost.push({
        _tag: 'Lost',
        cause: 'pending-full',
        at: this.droppedSince,
        until: this.droppedUntil,
        facts: this.dropped,
        bodies: 0,
        bytes: 0,
      });
      this.dropped = 0;
      this.droppedSince = Number.POSITIVE_INFINITY;
      this.droppedUntil = Number.NEGATIVE_INFINITY;
    }
    const facts = opened.length + noted.length + ended.length + stored.length;
    return {
      cost,
      opened,
      noted,
      ended,
      stored,
      lost,
      facts,
      since: Number.isFinite(since) ? since : null,
      until: Number.isFinite(until) ? until : null,
    };
  }
}

export function written(db: EffectSQLiteBunDatabase, batch: Batch, projects: ReadonlyMap<string, number | null>) {
  return db.transaction(() =>
    Effect.gen(function* () {
      const losses = [...batch.lost];
      let declined = 0;
      let declinedSince = Number.POSITIVE_INFINITY;
      let declinedUntil = Number.NEGATIVE_INFINITY;
      function* admitted<T extends ActivityOpened | ActivityEnded | ActivityNoted>(rows: readonly T[]): Generator<readonly T[]> {
        let held: T[] = [];
        let bytes = 0;
        let touched = 0;
        for (const row of rows) {
          const encoded = metadata(row);
          bytes += encoded?.bytes ?? METADATA_BYTES;
          touched += 1;
          if (encoded !== undefined) held.push(JSON.parse(encoded.text) as T);
          else {
            declined += 1;
            declinedSince = Math.min(declinedSince, row.at);
            declinedUntil = Math.max(declinedUntil, row.at);
          }
          if (bytes >= DOCUMENTS_PER_STATEMENT || touched >= ROWS_PER_STATEMENT) {
            yield held;
            held = [];
            bytes = 0;
            touched = 0;
          }
        }
        if (touched > 0) yield held;
      }
      const placed = (row: ActivityOpened): boolean => typeof row.parent !== 'object' || row.parent === null;
      const targeted: ActivityOpened[] = [];
      for (const rows of admitted(batch.opened.filter((row) => !placed(row)))) {
        yield* Effect.yieldNow;
        if (rows.length === 0) continue;
        targeted.push(...rows);
        yield* db.run(sql`insert or ignore into activity
          (id, parent, parent_run, project, thread, run, kind, actor, trigger, attrs, opened_at, provider, model, rung, folded)
          values ${sql.join(
            rows.map((row) => openedValues(row, null, (row.parent as RunTarget).run, projects)),
            sql`, `,
          )}`);
      }
      for (const rows of admitted(batch.opened.filter(placed))) {
        yield* Effect.yieldNow;
        if (rows.length === 0) continue;
        yield* db.run(sql`insert or ignore into activity
          (id, parent, parent_run, project, thread, run, kind, actor, trigger, attrs, opened_at, provider, model, rung, folded)
          values ${sql.join(
            rows.map((row) => openedValues(row, row.parent as string | null, null, projects)),
            sql`, `,
          )}`);
      }
      const targets = [
        ...batch.opened.flatMap((row) => (placed(row) ? [] : [(row.parent as RunTarget).run])),
        ...batch.noted.flatMap((row) => (typeof row.activity === 'string' ? [] : [row.activity.run])),
      ];
      const roots = targets.length === 0 ? new Map<string, string>() : yield* rootsOf(db, targets);
      let unattached = 0;
      let unattachedSince = Number.POSITIVE_INFINITY;
      let unattachedUntil = Number.NEGATIVE_INFINITY;
      const missed = (at: number) => {
        unattached += 1;
        unattachedSince = Math.min(unattachedSince, at);
        unattachedUntil = Math.max(unattachedUntil, at);
      };
      const attached = targeted.flatMap((row) => {
        const root = roots.get((row.parent as RunTarget).run);
        if (root === undefined) {
          missed(row.at);
          return [];
        }
        return [sql`(${row.id}, ${root})`];
      });
      for (let at = 0; at < attached.length; at += ROWS_PER_STATEMENT) {
        yield* db.run(
          sql`update activity set parent = v.column2 from (values ${sql.join(attached.slice(at, at + ROWS_PER_STATEMENT), sql`, `)}) as v where activity.id = v.column1`,
        );
      }
      for (const rows of admitted(batch.ended)) {
        yield* Effect.yieldNow;
        if (rows.length === 0) continue;
        yield* db.run(sql`update activity set
            ended_at = v.column2, outcome = v.column3, reason = v.column4, message = v.column5, result = v.column6,
            account = coalesce(v.column7, account), input_tokens = v.column8, output_tokens = v.column9,
            cache_read_tokens = v.column10, cache_write_tokens = v.column11, reasoning_tokens = v.column12,
            folded = case when v.column13 is null then activity.folded else json_patch(coalesce(activity.folded, '{}'), v.column13) end
          from (values ${sql.join(rows.map(endedValues), sql`, `)}) as v
          where activity.id = v.column1`);
      }
      for (const pending of admitted(batch.noted)) {
        yield* Effect.yieldNow;
        const rows = pending.flatMap((row) => {
          if (typeof row.activity === 'string') return [{ activity: row.activity, row }];
          const root = roots.get(row.activity.run);
          if (root === undefined) {
            missed(row.at);
            return [];
          }
          return [{ activity: root, row }];
        });
        if (rows.length === 0) continue;
        yield* db.run(sql`insert into note (activity, at, body, folded)
          values ${sql.join(
            rows.map(({ activity, row }) => sql`(${activity}, ${row.at}, ${canonical(row.note)}, ${folded({ note: row.note })})`),
            sql`, `,
          )}`);
      }
      for (const rows of chunks(batch.stored)) {
        yield* db.run(sql`insert or ignore into body (activity, n, kind, at, bucket, bytes, size, content_type, state, form, base_activity, base_n)
          values ${sql.join(rows.map(storedValues), sql`, `)}`);
      }
      if (declined > 0)
        losses.push({
          _tag: 'Lost',
          cause: 'metadata-ceiling',
          at: declinedSince,
          until: declinedUntil,
          facts: declined,
          bodies: 0,
          bytes: 0,
        });
      if (unattached > 0)
        losses.push({
          _tag: 'Lost',
          cause: 'unattached',
          at: unattachedSince,
          until: unattachedUntil,
          facts: unattached,
          bodies: 0,
          bytes: 0,
        });
      for (const rows of chunks(losses)) {
        yield* db.run(sql`insert into loss (at, until, unknown, cause, facts, bodies, bytes)
          values ${sql.join(
            rows.map(
              (row) =>
                sql`(${row.at}, ${row.until ?? row.at}, ${row.unknown === true ? 1 : 0}, ${row.cause}, ${row.facts}, ${row.bodies}, ${row.bytes})`,
            ),
            sql`, `,
          )}`);
      }
    }),
  );
}

export function lost(db: EffectSQLiteBunDatabase, row: Lost) {
  return db.run(
    sql`insert into loss (at, until, unknown, cause, facts, bodies, bytes) values (${row.at}, ${row.until ?? row.at}, ${row.unknown === true ? 1 : 0}, ${row.cause}, ${row.facts}, ${row.bodies}, ${row.bytes})`,
  );
}

function rootsOf(db: EffectSQLiteBunDatabase, runs: readonly string[]) {
  return Effect.map(
    db.all<{ readonly run: string; readonly id: string }>(sql`select run, id from (
        select a.run, a.id, row_number() over (partition by a.run order by a.opened_at desc, a.id desc) as place
        from activity a left join activity p on p.id = a.parent
        where a.run in (select value from json_each(${JSON.stringify([...new Set(runs)])}))
          and a.parent_run is null and (p.id is null or p.run is not a.run)
      ) where place = 1`),
    (rows) => new Map(rows.map((row) => [row.run, row.id])),
  );
}

function openedValues(
  row: ActivityOpened,
  parent: string | null,
  parentRun: string | null,
  projects: ReadonlyMap<string, number | null>,
): SQL {
  const model = row.kind === MODEL_CALL.name ? (row.attrs as ModelCallAttrs) : null;
  return sql`(${row.id}, ${parent}, ${parentRun}, ${row.thread === null ? row.project : (projects.get(row.thread) ?? null)}, ${row.thread},
    ${row.run}, ${row.kind}, ${canonical(row.actor)}, ${row.trigger === null ? null : canonical(row.trigger)},
    ${canonical(row.attrs)}, ${row.at}, ${model?.provider ?? null}, ${model?.model ?? null}, ${model?.rung ?? null},
    ${folded({ actor: row.actor, trigger: row.trigger, attrs: row.attrs })})`;
}

function endedValues(row: ActivityEnded): SQL {
  const usage = 'usage' in row.result ? (row.result.usage as ModelCallUsage | undefined) : undefined;
  const account = 'account' in row.result && typeof row.result.account === 'string' ? row.result.account : null;
  return sql`(${row.activity}, ${row.at}, ${row.outcome}, ${row.reason}, ${row.message}, ${canonical(row.result)},
    ${account}, ${usage?.inputTokens ?? null},
    ${usage?.outputTokens ?? null}, ${usage?.cacheReadInputTokens ?? null}, ${usage?.cacheWriteInputTokens ?? null},
    ${usage?.reasoningTokens ?? null}, ${folded({ message: row.message, reason: row.reason, result: row.result, account })})`;
}

function storedValues(row: BodyStored): SQL {
  const dot = row.base === null ? -1 : row.base.lastIndexOf('.');
  const baseActivity = row.base === null ? null : row.base.slice(0, dot);
  const baseN = row.base === null ? null : Number(row.base.slice(dot + 1));
  return sql`(${row.activity}, ${row.n}, ${row.kind}, ${row.at}, ${row.bucket}, ${row.bytes}, ${row.size}, ${row.contentType}, ${row.state}, ${row.form}, ${baseActivity}, ${baseN})`;
}

function* chunks<T>(rows: readonly T[]): Generator<readonly T[]> {
  for (let at = 0; at < rows.length; at += ROWS_PER_STATEMENT) yield rows.slice(at, at + ROWS_PER_STATEMENT);
}
