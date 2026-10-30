import { isAbsolute, resolve } from 'node:path';
import { Effect } from 'effect';
import type { SubjectPlace } from '../platform/contract/service/place.js';
import { CallPlace } from '../platform/contract/service/place.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { CheckoutPaths, type PlaceUnread } from './contract/service/checkoutPaths.js';

const unread = (failure: PlaceUnread) => new GateRefusal('files', failure.reason, ['read the checkout again']);

const placedPath = Effect.fnUntraced(function* (path: string) {
  const here = yield* CallPlace;
  const absolute = isAbsolute(path) ? path : here?.checkout == null ? null : resolve(here.checkout, path);
  if (absolute === null) return null;
  return yield* (yield* CheckoutPaths).placeAcross(absolute).pipe(Effect.mapError(unread));
});

const pathPlace = Effect.fn('workspace.pathPlace')(function* (path: string) {
  const placed = yield* placedPath(path);
  return placed === null ? null : { projectId: placed.projectId, checkout: placed.root, branch: null };
});

const pathSpelling = Effect.fn('workspace.pathSpelling')(function* (path: string) {
  if (isAbsolute(path)) return null;
  const placed = yield* placedPath(path);
  const here = yield* CallPlace;
  return placed === null || placed.projectId === here?.projectId ? null : placed.path;
});

const checkoutPlace = Effect.fn('workspace.checkoutPlace')(function* (named: string) {
  const here = yield* CallPlace;
  const root = yield* (yield* CheckoutPaths).rootAcross(named, here?.projectId ?? null).pipe(Effect.mapError(unread));
  if (root === null)
    return yield* new GateRefusal('not-found', `${named} is not a registered checkout.`, ['name a registered checkout root']);
  return { projectId: root.projectId, checkout: root.path, branch: null };
});

export const WORKSPACE_SUBJECTS: readonly SubjectPlace[] = [
  { kind: 'path', place: pathPlace, canonical: pathSpelling },
  { kind: 'checkout', place: checkoutPlace },
];
