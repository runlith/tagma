import { Context, type Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { AccessRefusal, Device, Pairing, PairingRefusal } from '../wire/access.js';

export type AccessRequest = {
  readonly origin: string | undefined;
  readonly fetchSite: string | undefined;
  readonly credential: string | undefined;
  readonly mutates: boolean;
  readonly connection: boolean;
};

export type Admitted = {
  readonly device: string;
  readonly renewed: boolean;
};

export type PairRequest = {
  readonly origin: string | undefined;
  readonly userAgent: string | undefined;
};

export type Paired = {
  readonly device: Device;
  readonly credential: string;
  readonly machine: string;
};

export type DevicePlace = { readonly pairedAt: number; readonly id: string };

export type DevicePage = {
  readonly devices: readonly Device[];
  readonly total: number;
  readonly last: DevicePlace | null;
  readonly more: boolean;
};

export type DeviceRevoked = { readonly deviceId: string };

export class Devices extends Context.Service<
  Devices,
  {
    admit(request: AccessRequest): Effect.Effect<Admitted, GateRefusal<AccessRefusal> | StoreFailure>;
    pair(request: PairRequest, code: Effect.Effect<string, GateRefusal>): Effect.Effect<Paired, GateRefusal | StoreFailure>;
    readonly code: Effect.Effect<Pairing, GateRefusal<'remote-not-ready'> | StoreFailure>;
    readonly standing: Effect.Effect<Pairing | null>;
    list(ask: { readonly limit: number; readonly after: DevicePlace | null }): Effect.Effect<DevicePage, StoreFailure>;
    revoke(id: string): Effect.Effect<void, GateRefusal<'unknown-device'> | StoreFailure>;
    paired(id: string): Effect.Effect<boolean, StoreFailure>;
    readonly revoked: Stream.Stream<DeviceRevoked>;
  }
>()('tagma/remote/Devices') {}
