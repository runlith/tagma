import { expect, test } from 'bun:test';
import { stepBackLosses } from './migrationLaw.js';

const BASE = [
  'CREATE TABLE `events` (`id` integer PRIMARY KEY, `body` text)',
  'CREATE INDEX `events_body` ON `events` (`body`)',
  'CREATE TABLE `entities` (`id` integer PRIMARY KEY, `name` text, `note` text)',
  'CREATE TABLE `labels` (`id` integer PRIMARY KEY)',
  'CREATE TABLE `owners` (`id` integer PRIMARY KEY)',
];

const lossesOf = (statements: readonly string[], aside: string | null = null) =>
  stepBackLosses(
    [
      { name: 'base', sql: BASE.join('\n--> statement-breakpoint\n'), back: null, aside: null },
      { name: 'judged', sql: statements.join('\n--> statement-breakpoint\n'), back: null, aside },
    ],
    new Set(['judged']),
  ).map((loss) => loss.fingerprint);

test('a migration that only adds, or rebuilds a table through a copy renamed into its place, loses nothing on a step back', () => {
  expect(
    lossesOf([
      'PRAGMA foreign_keys=OFF',
      'CREATE TABLE `__new_events` (`id` integer PRIMARY KEY, `body` text NOT NULL)',
      "INSERT INTO `__new_events`(`id`, `body`) SELECT `id`, coalesce(`body`, '') FROM `events`",
      'DROP TABLE `events`',
      'ALTER TABLE `__new_events` RENAME TO `events`',
      'PRAGMA foreign_keys=ON',
      'CREATE TABLE `members` (`id` integer PRIMARY KEY)',
      'INSERT INTO `members` (`id`) VALUES (1)',
      'ALTER TABLE `events` ADD `owner` integer',
      'CREATE INDEX `events_owner` ON `events` (`owner`)',
    ]),
  ).toEqual([]);
});

test('a rename and rewritten rows need a back script, and a dropped column or table needs aside.json to keep it', () => {
  const renamed = 'ALTER TABLE `events` RENAME TO `moved`';
  const column = 'ALTER TABLE `entities` RENAME COLUMN `name` TO `title`';
  const narrowed = 'ALTER TABLE `entities` DROP COLUMN `note`';
  const dropped = 'DROP TABLE `labels`';
  const rewritten = "UPDATE `entities` SET `title` = 'x'";
  const deleted = 'DELETE FROM `owners`';
  const statements = [renamed, column, narrowed, dropped, rewritten, deleted];
  expect(lossesOf(statements)).toEqual([
    `back events ${renamed}`,
    `back entities ${column}`,
    `back entities ${rewritten}`,
    `back owners ${deleted}`,
    'drops entities note',
    'drops labels',
  ]);
  expect(lossesOf(statements, '{"tables":["entities"],"derived":["labels"]}')).toEqual([
    `back events ${renamed}`,
    `back entities ${column}`,
    `back entities ${rewritten}`,
    `back owners ${deleted}`,
  ]);
});
