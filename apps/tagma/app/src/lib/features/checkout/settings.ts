import GitBranch from '@lucide/svelte/icons/git-branch';
import type { SettingsSection } from '$lib/features/settings/section.js';

export const sections: readonly SettingsSection[] = [{ id: 'checkout', group: 'project', order: 7, icon: GitBranch }];
