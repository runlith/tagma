import { readFileSync } from 'node:fs';
import { serve } from '../worker.js';
import { parseBinaryCookies } from './binarycookies.js';

const DENIED = new Set(['EPERM', 'EACCES']);

const codeOf = (cause: unknown): string => (cause as { readonly code?: string }).code ?? '';

const firstFile = (candidates: readonly string[]): Buffer => {
  for (const [index, file] of candidates.entries()) {
    try {
      return readFileSync(file);
    } catch (cause) {
      if (codeOf(cause) !== 'ENOENT' || index === candidates.length - 1) throw cause;
    }
  }
  throw new Error('no Safari cookies file was named');
};

serve(
  (candidates: readonly string[]) => parseBinaryCookies(firstFile(candidates)),
  (cause) =>
    DENIED.has(codeOf(cause))
      ? {
          message: 'macOS keeps the Safari cookies behind Full Disk Access, and the process running the Tagma server lacks it',
          unblock: [
            'in System Settings → Privacy & Security → Full Disk Access, turn on the app that started the Tagma server: Tagma when the app runs it, your terminal when you started it there; then import again',
          ],
        }
      : codeOf(cause) === 'ENOENT'
        ? { message: 'Safari keeps no cookies file on this Mac', unblock: ['import from another browser'] }
        : { message: `the Safari cookies could not be read: ${String(cause)}`, unblock: ['import again'] },
);
