import GitFork from '@lucide/svelte/icons/git-fork';
import type { SettingsSection } from '$lib/features/settings/section.js';

export const sections: readonly SettingsSection[] = [{ id: 'worktrees', group: 'project', order: 6, icon: GitFork }];
