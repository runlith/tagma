import { sql, type SQL } from 'drizzle-orm';

export const ACTIVITY_FIELDS = [
  'id',
  'parent',
  'thread',
  'run',
  'kind',
  'actor',
  'trigger',
  'openedAt',
  'endedAt',
  'durationMs',
  'outcome',
  'reason',
  'message',
  'provider',
  'model',
  'rung',
  'account',
  'usage',
  'attrs',
  'result',
  'notes',
  'bodies',
] as const;

export type ActivityValue = string | number | boolean | null;

export type ActivityPredicate = {
  readonly path: string;
  readonly op: 'eq' | 'in' | 'exists' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';
  readonly value?: ActivityValue | readonly ActivityValue[];
};

export type ActivityOrder = { readonly by: string; readonly dir: 'asc' | 'desc' };

export type Term = { readonly type: SQL; readonly value: SQL; readonly json: SQL };

const iso = (column: string) => sql.raw(`strftime('%Y-%m-%dT%H:%M:%fZ', ${column} / 1000.0, 'unixepoch')`);

const SCALARS: Readonly<Record<string, SQL>> = {
  id: sql`a.id`,
  parent: sql`a.parent`,
  thread: sql`a.thread`,
  run: sql`a.run`,
  kind: sql`a.kind`,
  openedAt: iso('a.opened_at'),
  endedAt: sql`(case when a.ended_at is null then null else ${iso('a.ended_at')} end)`,
  durationMs: sql`(a.ended_at - a.opened_at)`,
  outcome: sql`coalesce(a.outcome, 'open')`,
  reason: sql`a.reason`,
  message: sql`a.message`,
  provider: sql`a.provider`,
  model: sql`a.model`,
  rung: sql`a.rung`,
  account: sql`a.account`,
};

const NOTES = sql`(select json_group_array(json(entry)) from (
  select json_set(n.body, '$.at', ${iso('n.at')}) as entry from note n where n.activity = a.id order by n.id
))`;

const BODIES = sql`(select json_group_array(json(entry)) from (
  select json_object('n', b.n, 'kind', b.kind, 'contentType', b.content_type, 'size', b.size, 'bytes', b.bytes, 'state', b.state) as entry
  from body b where b.activity = a.id order by b.n
))`;

const DOCUMENTS: Readonly<Record<string, SQL>> = {
  actor: sql`a.actor`,
  trigger: sql`a.trigger`,
  attrs: sql`a.attrs`,
  result: sql`a.result`,
  notes: NOTES,
  bodies: BODIES,
};

const USAGE: Readonly<Record<string, SQL>> = {
  inputTokens: sql`a.input_tokens`,
  outputTokens: sql`a.output_tokens`,
  cacheReadInputTokens: sql`a.cache_read_tokens`,
  cacheWriteInputTokens: sql`a.cache_write_tokens`,
  reasoningTokens: sql`a.reasoning_tokens`,
};

const USED = sql`(a.input_tokens is not null or a.output_tokens is not null)`;

const ABSENT: Term = { type: sql`null`, value: sql`null`, json: sql`null` };

const jsonType = (type: SQL) => sql`(case ${type} when 'integer' then 'number' when 'real' then 'number' else ${type} end)`;

export function term(path: string): Term {
  const [root = '', ...rest] = path.split('.');
  const scalar = SCALARS[root];
  if (scalar !== undefined) {
    if (rest.length > 0) return ABSENT;
    return {
      type: sql`(case when ${scalar} is null then 'null' when typeof(${scalar}) in ('integer', 'real') then 'number' else 'text' end)`,
      value: scalar,
      json: scalar,
    };
  }
  const document = DOCUMENTS[root];
  if (document !== undefined) {
    if (rest.length === 0) {
      return {
        type: sql`(case when ${document} is null then 'null' else ${jsonType(sql`json_type(${document})`)} end)`,
        value: document,
        json: sql`json(${document})`,
      };
    }
    const at = navigated(document, rest);
    return { type: jsonType(sql`json_type(${at})`), value: sql`(${at} ->> '$')`, json: at };
  }
  if (root === 'usage') {
    const whole = sql`json_object(${sql.join(
      Object.entries(USAGE).map(([key, column]) => sql`${key}, ${column}`),
      sql`, `,
    )})`;
    if (rest.length === 0) {
      return {
        type: sql`(case when ${USED} then 'object' else 'null' end)`,
        value: whole,
        json: sql`(case when ${USED} then ${whole} else null end)`,
      };
    }
    const column = rest.length === 1 ? USAGE[rest[0]!] : undefined;
    if (column === undefined) return ABSENT;
    return {
      type: sql`(case when ${USED} then (case when ${column} is null then 'null' else 'number' end) else null end)`,
      value: column,
      json: column,
    };
  }
  return ABSENT;
}

const FOLDED_SCALARS = new Set(['message', 'reason', 'account']);
const FOLDED_DOCUMENTS = new Set(['actor', 'trigger', 'attrs', 'result']);

const FOLDED_NOTES = sql`(select json_group_array(json(entry)) from (
  select coalesce(n.folded -> '$.note', n.body) as entry from note n where n.activity = a.id order by n.id
))`;

function foldedText(path: string): SQL {
  const [root = '', ...rest] = path.split('.');
  if (FOLDED_SCALARS.has(root) && rest.length === 0) return sql`(a.folded ->> ${keyPath([root])})`;
  if (rest.length === 0) return sql`null`;
  if (FOLDED_DOCUMENTS.has(root)) return sql`(${navigated(sql`(a.folded -> ${keyPath([root])})`, rest)} ->> '$')`;
  if (root === 'notes') return sql`(${navigated(FOLDED_NOTES, rest)} ->> '$')`;
  return sql`null`;
}

export function matching(where: readonly ActivityPredicate[]): SQL {
  if (where.length === 0) return sql`1`;
  return sql.join(
    where.map((predicate) => sql`(${holds(term(predicate.path), predicate)})`),
    sql` and `,
  );
}

function holds(held: Term, predicate: ActivityPredicate): SQL {
  const { op, value } = predicate;
  if (op === 'exists') return value === false ? sql`${held.type} is null` : sql`${held.type} is not null`;
  if (op === 'in') {
    const members = Array.isArray(value) ? (value as readonly ActivityValue[]) : [];
    return members.length === 0
      ? sql`0`
      : sql.join(
          members.map((member) => sql`(${equal(held, member)})`),
          sql` or `,
        );
  }
  const single = value as ActivityValue;
  if (op === 'eq') return equal(held, single);
  if (op === 'contains') return contains(held, single, predicate.path);
  if (typeof single !== 'number' && typeof single !== 'string') return sql`0`;
  const comparison = op === 'gt' ? sql`>` : op === 'gte' ? sql`>=` : op === 'lt' ? sql`<` : sql`<=`;
  return sql`${held.type} = ${typeof single === 'number' ? 'number' : 'text'} and ${held.value} ${comparison} ${single}`;
}

function equal(held: Term, value: ActivityValue): SQL {
  if (value === null) return sql`${held.type} = 'null'`;
  if (typeof value === 'boolean') return sql`${held.type} = ${value ? 'true' : 'false'}`;
  return sql`${held.type} = ${typeof value === 'number' ? 'number' : 'text'} and ${held.value} = ${value}`;
}

function contains(held: Term, value: ActivityValue, path: string): SQL {
  const array = sql`exists (select 1 from json_each(case when ${held.type} = 'array' then ${held.json} else '[]' end) e where ${element(value)})`;
  if (typeof value !== 'string') return value === null ? sql`0` : array;
  const key = sql`json_type(case when ${held.type} = 'object' then ${held.json} else '{}' end, ${keyPath([value])})`;
  const text = sql`instr(lower(coalesce(${foldedText(path)}, ${held.value})), ${value.toLowerCase()}) > 0`;
  return sql`((${held.type} = 'text' and ${text}) or ${array} or ${key} is not null)`;
}

function element(value: ActivityValue): SQL {
  if (value === null) return sql`e.type = 'null'`;
  if (typeof value === 'boolean') return sql`e.type = ${value ? 'true' : 'false'}`;
  if (typeof value === 'number') return sql`e.type in ('integer', 'real') and e.value = ${value}`;
  return sql`e.type = 'text' and e.value = ${value}`;
}

const INDEX = /^(0|[1-9]\d*)$/;

function keyPath(segments: readonly string[]): string {
  return `$${segments.map((segment) => `."${segment.replaceAll('"', '\\"')}"`).join('')}`;
}

function navigated(document: SQL, segments: readonly string[]): SQL {
  let at = document;
  let keys: string[] = [];
  const keyed = () => {
    if (keys.length > 0) at = sql`(${at} -> ${keyPath(keys)})`;
    keys = [];
  };
  for (const segment of segments) {
    if (!INDEX.test(segment)) {
      keys.push(segment);
      continue;
    }
    keyed();
    at = sql`(select case json_type(v) when 'array' then v -> ${`$[${segment}]`} else v -> ${keyPath([segment])} end from (select ${at} as v))`;
  }
  keyed();
  return at;
}

export function rank(held: Term, dir: 'asc' | 'desc'): SQL {
  const direction = sql.raw(dir);
  return sql`(${held.type} is null), (case ${held.type} when 'number' then 0 when 'text' then 1 when 'true' then 2 when 'false' then 2 else 3 end) ${direction},
    (case when ${held.type} in ('number', 'text', 'true', 'false') then ${held.value} else cast(${held.json} as text) end) ${direction}`;
}

export function projected(paths: readonly string[]): SQL {
  if (paths.length === 0) return sql`'{}'`;
  return sql`(select json_group_object(path, json(value)) from (${sql.join(
    paths.map((path) => {
      const held = term(path);
      return sql`select ${path} as path, (json_array(${held.json}) -> '$[0]') as value where ${held.type} is not null`;
    }),
    sql` union all `,
  )}))`;
}

export function unprojected(text: string): Readonly<Record<string, unknown>> {
  return JSON.parse(text) as Readonly<Record<string, unknown>>;
}
