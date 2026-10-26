export type Guest = {
  readonly container: string;
};

export const GUEST_PROGRAM = '/opt/tagma/guest.ts';

export const GUEST_PROXY = '/opt/tagma/proxy.ts';

export const PROXY_PORT = 8080;

export const GUEST_INTERPRETER = 'bun';

export const GUEST_RIPGREP = '/usr/bin/rg';

export const GUEST_SHELL = '/bin/sh';

export const GUEST_TREE = '/work';

export const GUEST_TMP = '/tmp';

export const GUEST_HOME = '/home/guest';

export const GUEST_USER = '65534:65534';

export const GUEST_REGISTER = `${GUEST_TMP}/.tagma-exec`;
