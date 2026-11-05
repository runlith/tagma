import { expect, test } from 'bun:test';
import { migrationIssues, unreturnedIssues } from './migrationLaw.js';

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

test('a migration that only adds, or rebuilds a table through a copy renamed into its place, returns without an authored script', () => {
  expect(
    unreturnedIssues([
      'PRAGMA foreign_keys=OFF',
      'CREATE TABLE `__new_events` (`id` integer PRIMARY KEY, `body` text NOT NULL)',
      "INSERT INTO `__new_events`(`id`, `body`) SELECT `id`, coalesce(`body`, '') FROM `events`",
      'DROP TABLE `events`',
      'ALTER TABLE `__new_events` RENAME TO `events`',
      'PRAGMA foreign_keys=ON',
      'CREATE TABLE `owners` (`id` integer PRIMARY KEY)',
      'INSERT INTO `owners` (`id`) VALUES (1)',
      'ALTER TABLE `events` ADD `owner` integer',
      'CREATE INDEX `events_owner` ON `events` (`owner`)',
      'DROP INDEX `events_body`',
    ]),
  ).toEqual([]);
});

test('a rename, a dropped column or table and rewritten rows of a table the build before reads each need an authored script', () => {
  const renamed = 'ALTER TABLE `events` RENAME TO `moved`';
  const column = 'ALTER TABLE `entities` RENAME COLUMN `name` TO `title`';
  const narrowed = 'ALTER TABLE `entities` DROP COLUMN `note`';
  const dropped = 'DROP TABLE `labels`';
  const rewritten = "UPDATE `entities` SET `title` = 'x'";
  const deleted = 'DELETE FROM `owners`';
  expect(
    unreturnedIssues([renamed, column, narrowed, dropped, rewritten, deleted]).map((issue) => `${issue.table} ${issue.statement}`),
  ).toEqual([
    `events ${renamed}`,
    `entities ${column}`,
    `entities ${narrowed}`,
    `entities ${rewritten}`,
    `owners ${deleted}`,
    `labels ${dropped}`,
  ]);
});
