import { Layer } from 'effect';
import { checkoutBuildsLayer } from '../../checkout-builds/runner.js';
import { devSurfaceLayer } from '../../checkout-builds/surface.js';
import { SourceChanges } from '../../checkout-builds/contract/service/changes.js';
import { buildPlaces } from '../../checkout-builds/places.js';
import type { RunningRevision } from '../../checkout-builds/reading.js';
import { labelRevision } from '../../installation/contract/wire/layout.js';
import type { BindingChoice, DoorPlace, NextPlace, SourcePlace } from '../next.js';
import { sourceChanges } from './sourceChanges.js';

const runningRevision = ({ installation, source }: NextPlace): RunningRevision | null => {
  if (installation === undefined) {
    const revision = source?.revision ?? null;
    return revision === null ? null : { ...revision, tree: null };
  }
  const revision = labelRevision(installation.manifest.identity.build);
  return revision === null
    ? null
    : { ...revision, tree: installation.manifest.identity.tree ?? null, inputs: installation.manifest.origin?.inputs };
};

const checkoutOf = (place: SourcePlace): string | undefined =>
  place.installation === undefined ? place.checkout : place.installation.manifest.origin?.checkout;

const nextInstallation = (place: NextPlace) => {
  const { log, record, worktrees } = buildPlaces(place.dataPath);
  return checkoutBuildsLayer({
    checkout: checkoutOf(place),
    log,
    record,
    worktrees,
    installations: place.installations,
    running: runningRevision(place),
    restart: place.restart,
    landed: place.landed,
    runsFrom: place.installation,
    downgrade: place.downgrade,
  }).pipe(Layer.provide(Layer.succeed(SourceChanges, sourceChanges(place.roots, place.watch))));
};

const door = (place: DoorPlace) => devSurfaceLayer({ checkout: checkoutOf(place), app: place.app, port: place.port });

export const BINDINGS: BindingChoice = { nextInstallation, door };
