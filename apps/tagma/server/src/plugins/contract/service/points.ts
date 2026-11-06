import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import { Context, Data, type Effect, type Result } from 'effect';
import type { PluginFaced } from '../../../platform/contract/service/contribution.js';
import type { ContributionEntry } from '../../../platform/contract/wire/contribution.js';
import type { PluginChecked } from '../wire/contributions.js';

export type PluginRef = {
  readonly id: string;
  readonly title: string;
  readonly root: string;
  readonly data: string;
};

export type PluginContribution<W> = {
  readonly plugin: PluginRef;
  readonly value: W;
  readonly caller: McpToolCaller;
};

export class PluginPointRefused extends Data.TaggedError('PluginPointRefused')<{
  readonly point: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.point}: ${this.reason}`;
  }
}

export type PluginRegister<W> = (contribution: PluginContribution<W>) => Effect.Effect<() => void, PluginPointRefused>;

export const checkedOf = <W>(checked: PluginChecked, point: PluginFaced<W>): W | undefined => checked[point.plugin.name] as W | undefined;

export class PluginPoints extends Context.Service<
  PluginPoints,
  {
    declare<W>(point: PluginFaced<W>, register: PluginRegister<W>): Effect.Effect<() => void>;
    check(plugin: string, contributes: Readonly<Record<string, unknown>>): Result.Result<PluginChecked, string>;
    title(name: string): string | undefined;
    entries(name: string, value: unknown): readonly ContributionEntry[];
    uses(name: string, value: unknown): string | null;
    publish(plugin: PluginRef, checked: PluginChecked, caller: McpToolCaller): Effect.Effect<() => void, PluginPointRefused>;
  }
>()('tagma/plugins/PluginPoints') {}
