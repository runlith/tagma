import EyeOff from '@lucide/svelte/icons/eye-off';
import FolderGit2 from '@lucide/svelte/icons/folder-git-2';
import type { StorageMode } from '@tagma/server/projects/contract/wire/project';

export const STORAGE: Record<StorageMode, { icon: typeof EyeOff; label: string; note: string }> = {
  stealth: { icon: EyeOff, label: 'Stealth', note: 'the graph lives under your home, the repository carries nothing' },
  team: { icon: FolderGit2, label: 'Team', note: 'the graph lives in .tagma inside the repository and ships with it' },
};
