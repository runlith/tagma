import { Effect, Layer } from 'effect';
import { unofferedLayer } from '../installation/unoffered.js';
import type { HttpClient } from 'effect/http';
import type { ProcessProvenance } from '../platform/contract/wire/provenance.js';
import type { Installation, InstallationFailure } from '../installation/contract/wire/manifest.js';
import { NextInstallation, type RestartRefused } from '../installation/contract/service/next.js';
import type { DowngradeSteps, GraphMarks } from '../installation/contract/service/steps.js';
import { withBackGraphs } from './backGraphs.js';
import type { Settings } from '../settings/contract/service/values.js';
import type { FileRoots } from '../workspace/contract/service/roots.js';
import type { CheckoutWatch } from '../workspace/contract/service/watch.js';
import type { TerminalRequests, Terminals } from '../executions/contract/service/terminals.js';
import type { TerminalEndings } from '../executions/contract/service/endings.js';
import type { TerminalScreens } from '../executions/contract/service/records.js';
import type { HostManagement } from '../executions/contract/service/host.js';
import type { ProjectIdentification, Projects } from '../projects/contract/service/registry.js';
import type { SurfaceApp } from '../checkout-builds/surface.js';
import type { Distribution } from '../cut/descriptor.js';
import { relative } from 'node:path';

export const appOf = ({ roots, client }: Distribution): SurfaceApp => ({
  root: relative(roots.checkout, client.root),
  config: client.config === null ? null : relative(roots.checkout, client.config),
});

export type SourcePlace = {
  readonly checkout: string;
  readonly installation: Installation | undefined;
};

export type DoorPlace = SourcePlace & { readonly app: SurfaceApp; readonly port: number };

export type NextPlace = SourcePlace & {
  readonly dataPath: string;
  readonly installations: string;
  readonly source: ProcessProvenance | undefined;
  readonly restart: Effect.Effect<void, RestartRefused>;
  readonly landed: Effect.Effect<string | null, InstallationFailure>;
  readonly downgrade: DowngradeSteps['Service'];
  readonly roots: FileRoots['Service'];
  readonly watch: CheckoutWatch['Service'];
  readonly graphs: GraphMarks;
};

export type NextNeeds = Settings | HttpClient.HttpClient;

export type DoorNeeds =
  | Terminals
  | TerminalRequests
  | TerminalEndings
  | TerminalScreens
  | HostManagement
  | Projects
  | ProjectIdentification
  | HttpClient.HttpClient;

export type Bindings = {
  readonly nextInstallation: (place: NextPlace) => Layer.Layer<NextInstallation, never, NextNeeds>;
  readonly door: (place: DoorPlace) => Layer.Layer<never, never, DoorNeeds>;
};

export type BindingChoice = {
  readonly nextInstallation?: Bindings['nextInstallation'];
  readonly door?: Bindings['door'];
};

export const boundOf = (choice: BindingChoice): Bindings => ({
  nextInstallation: (place) =>
    Layer.effect(
      NextInstallation,
      Effect.gen(function* () {
        return withBackGraphs(yield* NextInstallation, place.installations, place.graphs);
      }),
    ).pipe(Layer.provide((choice.nextInstallation ?? (() => unofferedLayer))(place))),
  door: choice.door ?? (() => Layer.empty),
});
