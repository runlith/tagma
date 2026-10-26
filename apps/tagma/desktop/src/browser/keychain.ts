import { createRequire } from 'node:module';
import type { Failure } from '@tagma/server/desktop-browser/contract/wire/channel';

export const KEYCHAIN_ADDON = 'keychain.node';

type Native = { readonly read: (service: string, account: string) => Promise<{ readonly status: number; readonly secret: string | null }> };

const NOT_FOUND = -25300;
const DENIED = new Set([-128, -25293, -25308]);

let native: Native | null = null;

const loaded = (): Native => {
  native ??= createRequire(import.meta.url)(`./${KEYCHAIN_ADDON}`) as Native;
  return native;
};

export const readKey = async (service: string, account: string): Promise<{ readonly key: string } | { readonly failure: Failure }> => {
  const { status, secret } = await loaded().read(service, account);
  if (status === 0 && secret !== null) return { key: secret };
  if (status === NOT_FOUND) return { failure: { kind: 'missing', message: `the macOS Keychain holds no ${service}` } };
  return {
    failure: {
      kind: 'refused',
      message: DENIED.has(status)
        ? `macOS Keychain access to ${service} was not allowed`
        : `the macOS Keychain answered status ${status} for ${service}`,
      unblock: ['import again and allow Tagma in the macOS Keychain prompt'],
    },
  };
};
