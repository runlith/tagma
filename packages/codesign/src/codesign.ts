import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CODESIGN = '/usr/bin/codesign';
const MACH_O = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);

export const isMachO = (path: string): boolean => {
  const head = Buffer.alloc(4);
  const file = openSync(path, 'r');
  try {
    return readSync(file, head, 0, 4, 0) === 4 && MACH_O.has(head.readUInt32BE(0));
  } finally {
    closeSync(file);
  }
};

export type Signing = {
  readonly identity: string;
  readonly timestamp: boolean;
};

export type Signed = { readonly _tag: 'Signed' } | { readonly _tag: 'Refused'; readonly detail: string };

const plistOf = (entitlements: readonly string[]): string => {
  const keys = entitlements.map((key) => `\t<key>${key}</key>\n\t<true/>\n`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${keys}</dict>\n</plist>\n`;
};

export const signCode = (path: string, signing: Signing, entitlements: readonly string[] = []): Signed => {
  const args = ['--force', '--sign', signing.identity, '--options', 'runtime', signing.timestamp ? '--timestamp' : '--timestamp=none'];
  const scratch = entitlements.length === 0 ? null : mkdtempSync(join(tmpdir(), 'codesign-'));
  try {
    if (scratch !== null) {
      const file = join(scratch, 'entitlements.plist');
      writeFileSync(file, plistOf(entitlements));
      args.push('--entitlements', file);
    }
    const ran = spawnSync(CODESIGN, [...args, path], { encoding: 'utf8' });
    if (ran.status === 0) return { _tag: 'Signed' };
    return { _tag: 'Refused', detail: ran.stderr?.trim() || ran.error?.message || `codesign exited ${ran.status}` };
  } finally {
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  }
};
