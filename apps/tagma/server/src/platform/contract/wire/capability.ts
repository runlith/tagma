import type { SettingKey } from './setting.js';

export type CapabilityId = string;

export type CapabilityCue = { readonly tool: string; readonly input: string; readonly matches: string };

export type CapabilityDeclaration = {
  readonly id: CapabilityId;
  readonly description: string;
  readonly enabledBy?: SettingKey<boolean>;
  readonly guide?: string;
  readonly cue?: CapabilityCue;
  readonly sections: readonly string[];
  readonly runtimeSources?: readonly string[];
  readonly joins?: readonly string[];
  readonly toolCode?: { readonly module: string; readonly names: readonly string[] };
};

export const AGENT_NEEDS = ['shared', 'history', 'forbids-comments', 'images'] as const;

export type AgentNeed = (typeof AGENT_NEEDS)[number];

export type AgentTool = {
  readonly capability: CapabilityId;
  readonly direct?: true;
  readonly runtime?: true;
  readonly needs?: readonly AgentNeed[];
  readonly companions?: readonly string[];
};
