import { expect, test } from 'bun:test';
import { migrationIssues } from './migrationLaw.js';

const history = new Set(['events']);

test('history permits metadata-only columns and trigger definitions', () => {
  for (const statement of [
    'alter table events add column label text',
    "alter table events add column label text default 'ready'",
    'alter table events add column count integer not null default 0',
    'alter table events add column rendered text generated always as (body) virtual',
    'create trigger copied after insert on events begin update entities set count = count + 1; end;',
    'drop trigger copied',
    "update entities set name = 'events'",
  ])
    expect(migrationIssues(statement, history)).toEqual([]);
});

test('history writes, reads, indexes and scanning column constraints name the refused operator', () => {
  for (const statement of [
    'update events set body = 1',
    'create index event_body on events(body)',
    'alter table events rename to moved',
    'insert into entities select * from events',
    'alter table events add column positive integer check (positive > 0)',
    'alter table events add column measured integer default (random())',
    'alter table events add column generated integer as (length(body)) stored',
    'alter table events add column required text as (body) not null',
  ])
    expect(migrationIssues(statement, history)).toEqual([expect.objectContaining({ table: 'events', statement })]);
  expect(migrationIssues('vacuum', history)).toEqual([expect.objectContaining({ table: null, statement: 'vacuum' })]);
});
