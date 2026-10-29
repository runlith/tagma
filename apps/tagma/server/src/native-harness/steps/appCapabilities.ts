import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { agentMeta, isRecord } from './meta.js';

const capability = (name: unknown): unknown =>
  name === 'plugins' ? 'apps' : typeof name === 'string' && name.startsWith('plugin:') ? `app:${name.slice(7)}` : name;

const tool = (name: unknown): unknown => (typeof name === 'string' && name.startsWith('plugin__') ? `app__${name.slice(8)}` : name);

const renamed = (names: unknown, rename: (name: unknown) => unknown): unknown => {
  if (!Array.isArray(names)) return names;
  const formed = names.map(rename);
  return formed.every((name, at) => name === names[at]) ? names : formed;
};

const formedOverlay = (overlay: Record<string, unknown>): Record<string, unknown> | null => {
  const capabilities = renamed(overlay.capabilities, capability);
  const tools = renamed(overlay.tools, tool);
  if (capabilities === overlay.capabilities && tools === overlay.tools) return null;
  const next: Record<string, unknown> = { ...overlay };
  if (capabilities !== overlay.capabilities) next.capabilities = capabilities;
  if (tools !== overlay.tools) next.tools = tools;
  return next;
};

const formedDefinition = (definition: unknown): unknown => {
  if (!isRecord(definition) || !isRecord(definition.profile) || !isRecord(definition.profile.overlay)) return definition;
  const overlay = formedOverlay(definition.profile.overlay);
  return overlay === null ? definition : { ...definition, profile: { ...definition.profile, overlay } };
};

export const appCapabilitiesForm: ThreadFormStep = {
  name: '20261029173100_app_capabilities',
  samples: {
    meta: {
      record: { agentId: 'tagma' },
      native: {
        profile: {
          id: 'scout',
          overlay: {
            id: 'scout',
            baseAgentId: 'tagma',
            capabilities: ['files', 'plugins', 'plugin:board'],
            tools: ['read', 'plugin__board__deal'],
          },
        },
        pendingDefinition: { profile: { id: 'scout', overlay: { id: 'scout', baseAgentId: 'tagma', capabilities: ['plugin:board'] } } },
      },
    },
  },
  meta: (meta) => {
    const read = agentMeta(meta);
    if (read === null) return null;
    const overlay = read.overlay === null ? null : formedOverlay(read.overlay);
    const profile = overlay === null || !isRecord(read.profile) ? read.profile : { ...read.profile, overlay };
    const formed = profile === read.profile ? meta : read.with({ agentId: read.agentId, profile });
    const native = isRecord(formed.native) ? formed.native : null;
    const definition = native === null ? undefined : formedDefinition(native.pendingDefinition);
    if (native !== null && definition !== native.pendingDefinition)
      return { ...formed, native: { ...native, pendingDefinition: definition } };
    return formed === meta ? null : formed;
  },
};
