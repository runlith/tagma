import type { Words } from '../../../platform/contract/wire/refusal.js';

export const PROJECT_WORDS = {
  folderMissing: { text: 'This folder could not be found. Choose it again.' },
  folderTaken: (project: string): Words => ({ text: `This folder already belongs to the project “${project}”.` }),
  folderUnwritable: { text: 'Tagma cannot write into this folder’s repository. Make it writable and try again.' },
  nameRefused: (name: string): Words => ({ text: `“${name}” cannot be a project name. Choose another name.` }),
  nameTaken: (name: string): Words => ({ text: `There is already a project named “${name}”. Choose another name.` }),
  nameRemembered: (name: string): Words => ({
    text: `“${name}” is the name of a project removed from Tagma. Add its folder to bring it back, or choose another name.`,
  }),
} as const;
