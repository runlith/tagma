const PREFIX = '.watch-cookie-';

const NAME = /^\.watch-cookie-\d+-\d+$/;

export const COOKIE_GLOB = `**/${PREFIX}[0-9]*-[0-9]*`;

export const cookieName = (pid: number, count: number): string => `${PREFIX}${pid}-${count}`;

export const isCookie = (path: string): boolean => NAME.test(path.slice(path.lastIndexOf('/') + 1));
