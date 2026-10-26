import type { Startup } from '@tagma/server/installation/contract/wire/restart';
import { CHANNEL } from '@tagma/server/composition/channel';
import type { Holder } from './installation.js';

export type LoaderState =
  | { readonly why: 'named-address' }
  | { readonly why: 'installing'; readonly build: string }
  | { readonly why: 'not-installed'; readonly build: string; readonly said: string | null; readonly detail: string }
  | { readonly why: 'starting' }
  | { readonly why: 'stalled'; readonly heldFor: string | null; readonly seconds: number }
  | { readonly why: 'transferring'; readonly from: string }
  | { readonly why: 'channel-active'; readonly holder: Holder }
  | { readonly why: 'switching'; readonly from: string }
  | { readonly why: 'not-started'; readonly detail: string; readonly startup: Startup | null }
  | { readonly why: 'unrestored'; readonly build: string; readonly said: string | null; readonly detail: string }
  | { readonly why: 'foreign' }
  | { readonly why: 'no-installation'; readonly detail: string }
  | { readonly why: 'unknown'; readonly detail: string };

export type WindowAct = 'retry' | 'switch' | 'report';

export const WINDOW_ACTS = 'tagma-window://';

export const windowAct = (url: string): WindowAct | null => {
  if (!url.startsWith(WINDOW_ACTS)) return null;
  const act = url.slice(WINDOW_ACTS.length).replace(/\/$/u, '');
  return act === 'retry' || act === 'switch' || act === 'report' ? act : null;
};

type Page = {
  readonly title: string;
  readonly said: readonly string[];
  readonly details: string | null;
  readonly acts: readonly (readonly [WindowAct, string])[];
};

const escaped = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const counted = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

const RETRY = ['retry', 'Try again'] as const;
const REPORT = ['report', 'Report a problem'] as const;

const at = (holder: Holder): string => {
  const parts = [
    holder.agents === null || holder.agents === 0 ? null : `${counted(holder.agents, 'agent is', 'agents are')} working`,
    holder.terminals === null || holder.terminals === 0 ? null : `${counted(holder.terminals, 'terminal is', 'terminals are')} open`,
  ].filter((part) => part !== null);
  return parts.length === 0 ? '' : ` ${parts.join(' and ')}.`;
};

const reached = (startup: Startup | null): string | null => {
  if (startup?.failure != null) return `${startup.failure.phase}: ${startup.failure.detail}`;
  if (startup === null || startup.status === 'ready') return null;
  return startup.step === null ? startup.phase : `${startup.phase}, step ${startup.step.index} of ${startup.step.total}`;
};

function pageOf(standing: LoaderState): Page {
  const name = CHANNEL.name;
  switch (standing.why) {
    case 'named-address':
      return {
        title: `${name} isn't answering here`,
        said: ['This window was opened on an address of its own, so it starts no Tagma and waits for that one.'],
        details: null,
        acts: [RETRY],
      };
    case 'installing':
      return {
        title: `Installing ${name} ${standing.build}…`,
        said: ['This takes a moment, and only happens once for each version.'],
        details: null,
        acts: [],
      };
    case 'not-installed':
      return {
        title: `${name} ${standing.build} didn't install`,
        said: [standing.said ?? 'Try again. If it keeps failing, report the problem and we will look into it.'],
        details: standing.detail,
        acts: [RETRY, REPORT],
      };
    case 'starting':
      return { title: `Starting ${name}…`, said: [], details: null, acts: [REPORT] };
    case 'stalled':
      return {
        title: `${name} stopped responding, so it is starting again…`,
        said: [
          `${standing.heldFor ?? 'One write'} held ${name}'s database for ${standing.seconds} seconds without doing anything, and everything else waited on it.`,
          'Agents that were working stop, and you can continue them once it is back.',
        ],
        details: null,
        acts: [REPORT],
      };
    case 'transferring':
      return {
        title: `Copying your threads and projects from ${standing.from}…`,
        said: [`${standing.from} keeps its own copy.`],
        details: null,
        acts: [],
      };
    case 'channel-active':
      return {
        title: `${standing.holder.name} is running`,
        said: [
          `Only one Tagma runs at a time.${at(standing.holder)}`,
          `Switching stops ${standing.holder.name} — its agents stop and its terminals close — and starts ${name}.`,
        ],
        details: null,
        acts: [['switch', `Switch to ${name}`]],
      };
    case 'switching':
      return { title: `Stopping ${standing.from}…`, said: [`${name} starts as soon as it has stopped.`], details: null, acts: [] };
    case 'not-started':
      return {
        title: `${name} didn't start`,
        said: ['Try again. If it keeps failing, report the problem: the report holds what Tagma wrote while starting.'],
        details: [standing.detail, reached(standing.startup)].filter((line) => line !== null).join('\n'),
        acts: [RETRY, REPORT],
      };
    case 'unrestored':
      return {
        title: `${name} ${standing.build} didn't start and couldn't bring your data back`,
        said: [
          standing.said ??
            `Your data stays as ${name} ${standing.build} left it, and only ${standing.build} opens it. Try again, or report the problem so it can be put right.`,
        ],
        details: standing.detail,
        acts: [RETRY, REPORT],
      };
    case 'foreign':
      return {
        title: `Something else is using ${name}'s place`,
        said: [`Another app, or ${name} of another user on this Mac, answers where ${name} should. Quit it, then try again.`],
        details: null,
        acts: [RETRY],
      };
    case 'no-installation':
      return {
        title: `${name} isn't installed`,
        said: [`Open the ${name} app you downloaded: it installs itself the first time it opens.`],
        details: standing.detail,
        acts: [RETRY, REPORT],
      };
    case 'unknown':
      return {
        title: 'Something went wrong',
        said: ['Try again. If it keeps failing, report the problem.'],
        details: standing.detail,
        acts: [RETRY, REPORT],
      };
  }
}

export function waitingPageUrl(standing: LoaderState): string {
  const page = pageOf(standing);
  const said = page.said.map((line) => `      <p>${escaped(line)}</p>`).join('\n');
  const details =
    page.details === null || page.details === ''
      ? ''
      : `      <details><summary>Details</summary><pre>${escaped(page.details)}</pre></details>\n`;
  const acts = page.acts.map(([act, label]) => `<a href="${WINDOW_ACTS}${act}">${escaped(label)}</a>`).join(' ');
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escaped(CHANNEL.name)}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: Canvas; color: CanvasText;
        font: 15px/1.6 ui-sans-serif, system-ui, sans-serif;
      }
      main { max-width: 34rem; padding: 2rem; }
      h1 { font-size: 1.05rem; font-weight: 600; margin: 0 0 .75rem; }
      p { margin: 0 0 .75rem; opacity: .8; }
      details { margin: 0 0 1rem; opacity: .7; }
      summary { cursor: pointer; }
      pre { white-space: pre-wrap; font: .85em/1.5 ui-monospace, SFMono-Regular, monospace; }
      nav { display: flex; gap: .5rem; }
      a { display: inline-block; padding: .35rem .9rem; border-radius: .4rem; border: 1px solid currentColor; text-decoration: none; color: inherit; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escaped(page.title)}</h1>
${said}
${details}      <nav>${acts}</nav>
    </main>
  </body>
</html>
`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
