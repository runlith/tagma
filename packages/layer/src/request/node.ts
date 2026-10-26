import { AsyncLocalStorage } from 'node:async_hooks';

import { emptyRouteData, type RouteData } from '../Router.js';
import type { Definition, MountedApp } from '../App.js';
import { installAppHolder, type AppHolder } from './holder.js';

export interface RequestApp {
  readonly id: string;
  readonly app: MountedApp;
  readonly address: { data: RouteData };
}

const storage = new AsyncLocalStorage<RequestApp>();

export function withRequestApp<T>(id: string, app: MountedApp, run: (request: RequestApp) => Promise<T>): Promise<T> {
  const request: RequestApp = { id, app, address: { data: emptyRouteData() } };
  return storage.run(request, () => run(request).finally(() => app.close()));
}

export function currentRequestApp(): RequestApp | undefined {
  return storage.getStore();
}

export function currentApp(definition?: Definition): MountedApp | undefined {
  const request = storage.getStore();
  if (!request) return undefined;
  return definition === undefined || request.app.definition === definition ? request.app : undefined;
}

export function holdApp(definition: Definition): MountedApp {
  const current = currentApp(definition);
  if (current) return current;
  throw new Error('No request app is open: the server hook opens one per request before any load runs');
}

export function releaseApp(): void {}

export function landApp(data: RouteData): void {
  const request = storage.getStore();
  if (request) request.address.data = data;
}

const requestHolder: AppHolder = { current: currentApp, hold: holdApp, release: releaseApp, land: landApp };

installAppHolder(requestHolder);
