import { Effect } from 'effect';
import { serve as serveCore, type HostInput } from '../host';
import type { HostTelemetryOptions } from '../hostTelemetry';
import { credentialsLayer } from '../posix/credentials';
import { platformLayer } from './platform';

export const serve = (input: HostInput, options?: { readonly telemetry?: HostTelemetryOptions }) =>
  serveCore(input, options).pipe(
    Effect.provide(platformLayer(input.library)),
    Effect.provide(credentialsLayer(input.registration.credentials)),
  );
