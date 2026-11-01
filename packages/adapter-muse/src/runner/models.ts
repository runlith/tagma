import type { Models } from './frames.js';

type Route = { readonly providerId: string; readonly profileId: string | null };

export class HostModels {
  private readonly windows: ReadonlyMap<string, number>;
  private readonly routes: ReadonlyMap<string, Route>;
  private readonly fallback: Route;

  constructor(listed: Models) {
    this.fallback = { providerId: listed.providerId, profileId: listed.profileId ?? null };
    this.windows = new Map(listed.models.flatMap((row) => (row.contextLimit === null ? [] : [[row.modelId, row.contextLimit] as const])));
    this.routes = new Map(
      listed.models.map(
        (row) => [row.modelId, { providerId: row.providerId, profileId: row.profileId ?? this.fallback.profileId }] as const,
      ),
    );
  }

  get provider(): string {
    return this.fallback.providerId;
  }

  windowOf(modelId: string): number | null {
    return this.windows.get(modelId) ?? null;
  }

  selection(modelId: string): { readonly modelId: string } & Route {
    return { modelId, ...(this.routes.get(modelId) ?? this.fallback) };
  }
}
