import type { Blocked } from '../contract/wire/access.js';
import { CLI_NAME, failureOf, type CliRun } from './cli.js';
import { serveArgs, type HttpsPort } from './mapping.js';

export const DOWNLOAD_LINK = 'https://tailscale.com/download';
export const DNS_SETTINGS_LINK = 'https://login.tailscale.com/admin/dns';
export const OPERATOR_COMMAND = `sudo ${CLI_NAME} set --operator=$USER`;

export const serveCommand = (httpsPort: HttpsPort, target: string): string => [CLI_NAME, ...serveArgs(httpsPort, target)].join(' ');

const ENABLE_LINK = /https:\/\/login\.tailscale\.com\/[^\s"'<>]+/u;
const ANY_LINK = /https:\/\/[^\s"'<>]+/u;
const OPERATOR_REFUSAL = /--operator|access denied/iu;

type BlockedExtras = { readonly command?: string; readonly link?: string };

export const blocked = (problem: Blocked['problem'], detail: string, extras: BlockedExtras = {}): Blocked => ({
  _tag: 'blocked',
  problem,
  detail,
  command: extras.command ?? null,
  link: extras.link ?? null,
});

const linkIn = (pattern: RegExp, text: string): string | null => {
  const found = pattern.exec(text)?.[0];
  return found === undefined ? null : found.replace(/[.,;:)]+$/u, '');
};

export const serveRefusal = (run: CliRun, deadlineMs: number): Blocked => {
  const detail = failureOf(run, deadlineMs);
  if (OPERATOR_REFUSAL.test(detail)) return blocked('needs-operator', detail, { command: OPERATOR_COMMAND });
  const enableLink = linkIn(ENABLE_LINK, detail);
  if (enableLink !== null) return blocked('https-off', detail, { link: enableLink });
  const anyLink = linkIn(ANY_LINK, detail);
  return anyLink === null ? blocked('refused', detail) : blocked('refused', detail, { link: anyLink });
};
