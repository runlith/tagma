import { dirname, join } from 'node:path';

export const INPUT_HELPER = 'Tagma Input';
export const INPUT_EXECUTABLE = 'runlith-desktop-input';

export const inputHelperIn = (executable: string): string =>
  join(dirname(executable), '..', 'Helpers', `${INPUT_HELPER}.app`, 'Contents', 'MacOS', INPUT_EXECUTABLE);
