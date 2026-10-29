import type { PermissionSubject, Raised } from '@runlith/agent/permissions';

export type PluginConsent = { readonly subjects: readonly PermissionSubject[]; readonly raised: readonly Raised[] };

export type PluginConsented = { readonly id: string; readonly consent: PluginConsent };
