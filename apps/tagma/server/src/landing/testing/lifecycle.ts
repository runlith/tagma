import { Effect } from 'effect';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import type { Intent, IntentLifecycle, IntentReceipt } from '../store/intentLifecycle.js';

export const storeFailure = () => new EffectDrizzleQueryError({ query: 'insert', params: [], cause: 'the disk went away' });

export const memoryIntents = () => {
  const intents = new Map<string, Intent>();
  const receipts = new Map<string, IntentReceipt>();
  const faults = { receive: 0 };
  const phase = (key: string, from: Intent['phase'], to: Intent['phase'], extra: Partial<Intent> = {}) =>
    Effect.sync(() => {
      const intent = intents.get(key);
      if (intent?.phase === from) intents.set(key, { ...intent, ...extra, phase: to });
    });
  const lifecycle: IntentLifecycle = {
    read: (key) =>
      Effect.sync(() => {
        const intent = intents.get(key);
        return intent === undefined ? null : { intent, receipt: receipts.get(key) ?? null };
      }),
    intend: (intent) => Effect.sync(() => void intents.set(intent.key, intent)),
    claim: (intent, abandoned) =>
      Effect.sync(() => {
        const standing = intents.get(intent.key);
        if (
          standing !== undefined &&
          abandoned !== null &&
          standing.phase === 'intended' &&
          standing.at.getTime() === abandoned.getTime()
        ) {
          intents.delete(intent.key);
        }
        if (intents.has(intent.key)) return false;
        intents.set(intent.key, intent);
        return true;
      }),
    witness: (key, commit, at) => phase(key, 'intended', 'publishing', { commit, witnessedAt: at }),
    receive: (key, commit, at) =>
      faults.receive > 0
        ? Effect.suspend(() => {
            faults.receive -= 1;
            return Effect.fail(storeFailure());
          })
        : Effect.andThen(
            Effect.sync(() => void receipts.set(key, { key, commit, at })),
            phase(key, 'publishing', 'published'),
          ),
    settle: (key) => phase(key, 'published', 'settled'),
    lose: (key) => phase(key, 'publishing', 'lost'),
    forget: (key, at) =>
      Effect.sync(() => {
        const intent = intents.get(key);
        if (at !== undefined && intent?.at.getTime() !== at.getTime()) return;
        if (intent?.phase === 'intended' || intent?.phase === 'publishing') intents.delete(key);
      }),
    land: (key, commit, at) =>
      Effect.sync(() => {
        const intent = intents.get(key);
        if (intent?.phase !== 'intended') return false;
        intents.set(key, { ...intent, phase: 'settled', commit, witnessedAt: at });
        receipts.set(key, { key, commit, at });
        return true;
      }),
    open: (kind, _after, limit) =>
      Effect.sync(() =>
        [...intents.values()]
          .filter((one) => one.kind === kind && ['intended', 'publishing', 'published'].includes(one.phase))
          .slice(0, limit),
      ),
    prune: (kind, before, limit) =>
      Effect.sync(() => {
        const ended = [...intents.values()]
          .filter((one) => one.kind === kind && (one.phase === 'settled' || one.phase === 'lost') && one.at < before)
          .slice(0, limit);
        for (const one of ended) intents.delete(one.key);
        return ended.length;
      }),
  };
  return { lifecycle, intents, faults };
};
