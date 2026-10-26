import { resolve } from 'node:path';
import { Layer } from 'effect';
import { checkoutBuildsLayer } from '../../checkout-builds/runner.js';
import { SourceChanges } from '../../checkout-builds/contract/service/changes.js';
import { buildPlaces } from '../../checkout-builds/places.js';
import type { RunningRevision } from '../../checkout-builds/reading.js';
import { labelRevision } from '../../installation/contract/wire/layout.js';
import { DEVELOPER_HOST_MODULES, SHARED_HOST_MODULES } from '../hostModules.generated.js';
import type { Bindings, NextPlace } from '../next.js';
import { sourceChanges } from './sourceChanges.js';

const runningRevision = ({ installation, source }: NextPlace): RunningRevision | null => {
  if (installation === undefined) {
    const revision = source?.revision ?? null;
    return revision === null ? null : { ...revision, tree: null };
  }
  const revision = labelRevision(installation.manifest.identity.build);
  return revision === null ? null : { ...revision, tree: installation.manifest.identity.tree ?? null };
};

const nextInstallation = (place: NextPlace) => {
  const { log, record, worktrees } = buildPlaces(place.dataPath);
  return checkoutBuildsLayer({
    checkout: place.installation === undefined ? resolve(place.serverPath, '..', '..', '..') : place.installation.manifest.origin?.checkout,
    log,
    record,
    worktrees,
    installations: place.installations,
    running: runningRevision(place),
    restart: place.restart,
    landed: place.landed,
  }).pipe(Layer.provide(Layer.succeed(SourceChanges, sourceChanges(place.roots, place.watch))));
};

export const BINDINGS: Bindings = {
  nextInstallation,
  hostModules: { shared: SHARED_HOST_MODULES, developer: DEVELOPER_HOST_MODULES },
};
