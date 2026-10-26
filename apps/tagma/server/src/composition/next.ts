import type { Layer } from 'effect';
import type { HttpClient } from 'effect/http';
import type { ProcessProvenance } from '../platform/contract/wire/provenance.js';
import type { Installation } from '../installation/contract/wire/manifest.js';
import type { NextInstallation } from '../installation/contract/service/next.js';
import type { DowngradeSteps } from '../installation/contract/service/steps.js';
import type { Settings } from '../settings/contract/service/values.js';
import type { FileRoots } from '../workspace/contract/service/roots.js';
import type { CheckoutWatch } from '../workspace/contract/service/watch.js';

export type NextPlace = {
  readonly serverPath: string;
  readonly dataPath: string;
  readonly installations: string;
  readonly installation: Installation | undefined;
  readonly source: ProcessProvenance | undefined;
  readonly restart: () => Promise<string | null>;
  readonly landed: () => Promise<string | null>;
  readonly refuses: (root: string) => Promise<string | null>;
  readonly downgrade: DowngradeSteps['Service'];
  readonly roots: FileRoots['Service'];
  readonly watch: CheckoutWatch['Service'];
};

export type NextNeeds = Settings | HttpClient.HttpClient;

export type Bindings = {
  readonly nextInstallation: (place: NextPlace) => Layer.Layer<NextInstallation, never, NextNeeds>;
};
