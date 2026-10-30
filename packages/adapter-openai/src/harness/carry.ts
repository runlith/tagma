import { basename, join } from 'node:path';
import { Effect, type FileSystem } from 'effect';
import type { HarnessCarry } from '@runlith/tagma/adapter/harness';
import { codexRolloutName } from './metadata.js';

const DAY_MS = 86_400_000;

const two = (value: number): string => String(value).padStart(2, '0');

const daysOf = (root: string): readonly string[] | null => {
  const hex = root.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(hex) || hex[12] !== '7') return null;
  const minted = parseInt(hex.slice(0, 12), 16);
  return [minted - DAY_MS, minted, minted + DAY_MS].map((at) => {
    const day = new Date(at);
    return join(String(day.getUTCFullYear()), two(day.getUTCMonth() + 1), two(day.getUTCDate()));
  });
};

const dated = Effect.fnUntraced(function* (files: FileSystem.FileSystem, sessions: string, days: readonly string[], root: string) {
  for (const day of days) {
    const folder = join(sessions, day);
    if (!(yield* files.exists(folder))) continue;
    const rollout = (yield* files.readDirectory(folder)).find((name) => codexRolloutName(name, root));
    if (rollout !== undefined) return [join('sessions', day, rollout)];
  }
  return [];
});

export const codexCarry: HarnessCarry = {
  folder: '.codex',
  session: Effect.fnUntraced(function* (files, home, root) {
    const sessions = join(home, 'sessions');
    if (!(yield* files.exists(sessions))) return [];
    const days = daysOf(root);
    if (days !== null) return yield* dated(files, sessions, days, root);
    const rollout = (yield* files.readDirectory(sessions, { recursive: true })).find((entry) => codexRolloutName(basename(entry), root));
    return rollout === undefined ? [] : [join('sessions', rollout)];
  }),
};
