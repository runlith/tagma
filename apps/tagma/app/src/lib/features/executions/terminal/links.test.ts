// @vitest-environment jsdom
import type { ILink, ILinkProvider } from '@xterm/xterm';
import { Host } from '@runlith/layer/Host';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { openEngine, type Engine } from './terminalEngine.js';
import {
  createLinks,
  extractUrls,
  installLinks,
  isDirectActivation,
  isHoverActive,
  installHoverReset,
  parseFileRefs,
  resetHoverCache,
  resolveFileRef,
  type HoverSchedule,
  type LinkCallbacks,
  type LinkMenu,
  type LinkModifier,
  type LinkOpener,
  type LinkRefused,
  type LinkTeller,
} from './links.js';
import TerminalLinkTip from './LinkTip.svelte';
import type { Link } from '$lib/features/opening/Link.js';
import type { PathRoad } from '$lib/features/opening/PathLinks.js';
import type { PathCode } from '$lib/features/opening/pathCode.js';

const opened: Engine[] = [];
const tips: (() => void)[] = [];
const told: LinkTeller = (link) => ({ text: link.kind === 'url' ? link.url : (link.link.target as PathCode).path, hints: [] });

const fileAt = (code: PathCode): Link => ({ kind: 'file', target: code });

const filesAt =
  (exists: (absolutePath: string) => Promise<boolean>): PathRoad =>
  async (path) =>
    (await exists(path)) ? fileAt : null;

afterEach(() => {
  for (const engine of opened.splice(0)) engine.dispose();
  for (const unmountTip of tips.splice(0)) unmountTip();
  document.body.replaceChildren();
});

function open(callbacks?: LinkCallbacks): Engine {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const engine = openEngine(host, { ...(callbacks ?? {}) }, new Host('desktop', 'macos'));
  opened.push(engine);
  const screen = engine.terminal.element?.querySelector<HTMLElement>('.xterm-screen');
  if (screen) {
    screen.getBoundingClientRect = () =>
      ({ width: engine.terminal.cols * 8, height: engine.terminal.rows * 16, left: 0, top: 0 }) as DOMRect;
  }
  return engine;
}

function mountTip(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = mount(TerminalLinkTip, { target: host });
  flushSync();
  const tip = host.querySelector<HTMLElement>('[data-link-tip]');
  if (!tip) throw new Error('No link tooltip drawn.');
  tips.push(() => {
    unmount(app);
    host.remove();
  });
  return tip;
}

type LinkRoadArgs = [
  tip: HTMLElement,
  open: LinkOpener,
  told: LinkTeller,
  menu: LinkMenu,
  road: PathRoad,
  refused: LinkRefused,
  projectRoot: string,
  modifier: LinkModifier,
];

function depsOver(
  tip: HTMLElement,
  overrides: Partial<{
    open: LinkOpener;
    menu: LinkMenu;
    pathExists: (absolutePath: string) => Promise<boolean>;
    road: PathRoad;
    refused: LinkRefused;
    projectRoot: string;
    modifier: LinkModifier;
  }> = {},
): LinkRoadArgs {
  return [
    tip,
    overrides.open ?? vi.fn<LinkOpener>(),
    told,
    overrides.menu ?? vi.fn<LinkMenu>(),
    overrides.road ?? filesAt(overrides.pathExists ?? (async () => false)),
    overrides.refused ?? vi.fn<LinkRefused>(),
    overrides.projectRoot ?? '/work/acme',
    overrides.modifier ?? 'meta',
  ];
}

function write(engine: Engine, data: string): Promise<void> {
  return new Promise((resolve) => engine.terminal.write(data, resolve));
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

function mouse(type: string, x: number, y: number, init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...init });
}

test('a URL wrapped across two rows opens as one link', async () => {
  const tip = mountTip();
  const opens = vi.fn<LinkOpener>();
  const links = createLinks(...depsOver(tip, { open: opens }));
  const engine = open(links.callbacks);
  links.install(engine);
  const url = `https://example.com/${'a'.repeat(100)}`;
  await write(engine, url);
  expect(engine.terminal.buffer.active.getLine(1)?.isWrapped).toBe(true);

  engine.terminal.element?.dispatchEvent(mouse('mousedown', 40, 20, { metaKey: true }));
  engine.terminal.element?.dispatchEvent(mouse('mouseup', 40, 20, { metaKey: true }));

  expect(opens.mock.calls).toEqual([[{ kind: 'url', url }, 'modified']]);
});

test('a mousedown-to-mouseup of 5 px is not an activation', () => {
  const engine = open();
  const tip = mountTip();
  const opens = vi.fn<LinkOpener>();
  const links = createLinks(...depsOver(tip, { open: opens }));
  const release = links.install(engine);

  engine.terminal.element?.dispatchEvent(mouse('mousedown', 100, 100, { metaKey: true }));
  document.dispatchEvent(mouse('mousemove', 105, 100));
  engine.terminal.element?.dispatchEvent(mouse('mouseup', 105, 100));

  links.callbacks.onLinkClick(mouse('click', 105, 100, { metaKey: true }), 'https://example.com/');
  expect(opens).not.toHaveBeenCalled();

  release();
});

test('a click without drag is an activation, and selecting over the URL is not', async () => {
  const engine = open();
  const tip = mountTip();
  const opens = vi.fn<LinkOpener>();
  const links = createLinks(...depsOver(tip, { open: opens }));
  const release = links.install(engine);
  await write(engine, 'https://example.com/ here');

  engine.terminal.element?.dispatchEvent(mouse('mousedown', 100, 100, { metaKey: true }));
  engine.terminal.element?.dispatchEvent(mouse('mouseup', 100, 100, { metaKey: true }));
  links.callbacks.onLinkClick(mouse('click', 100, 100, { metaKey: true }), 'https://example.com/');
  expect(opens).toHaveBeenCalledTimes(1);

  engine.terminal.select(0, 0, 20);
  expect(engine.terminal.hasSelection()).toBe(true);
  engine.terminal.element?.dispatchEvent(mouse('mousedown', 100, 100, { metaKey: true }));
  engine.terminal.element?.dispatchEvent(mouse('mouseup', 100, 100, { metaKey: true }));
  links.callbacks.onLinkClick(mouse('click', 100, 100, { metaKey: true }), 'https://example.com/');
  expect(opens).toHaveBeenCalledTimes(1);

  release();
});

test('a throwing provider answers no links and leaves the file provider standing', async () => {
  const engine = open();
  const tip = mountTip();
  engine.terminal.registerLinkProvider({
    provideLinks: () => {
      throw new Error('a provider nobody guarded');
    },
  });
  installLinks(engine, ...depsOver(tip, { pathExists: async (absolute) => absolute === '/work/acme/src/x.ts' }));
  await write(engine, 'see src/x.ts here');

  const service = (
    engine.terminal as unknown as {
      _core: { _linkifier: { value: { _linkProviderService: { linkProviders: ILinkProvider[] } } } };
    }
  )._core._linkifier.value._linkProviderService;
  expect(service.linkProviders.length).toBeGreaterThan(1);
  const answered: (ILink[] | undefined)[] = [];
  for (const provider of service.linkProviders) provider.provideLinks(1, (links) => answered.push(links));
  await settled();

  expect(answered).toContainEqual(undefined);
  const fileLinks = answered.flatMap((links) => links ?? []);
  expect(fileLinks.length).toBeGreaterThan(0);
  const first = fileLinks[0];
  first?.hover?.(mouse('mousemove', 0, 0), first?.text ?? '');
  flushSync();
  expect(tip.textContent).toContain('/work/acme/src/x.ts');
});

test('a probe that could not answer is not remembered as an absence: the next pass asks again', async () => {
  const engine = open();
  const tip = mountTip();
  let probes = 0;
  installLinks(
    engine,
    ...depsOver(tip, {
      pathExists: async (absolute) => {
        probes++;
        if (probes === 1) throw new Error('the path-exists read did not answer');
        return absolute === '/work/acme/src/x.ts';
      },
    }),
  );
  await write(engine, 'see src/x.ts here');

  const providers = (
    engine.terminal as unknown as {
      _core: { _linkifier: { value: { _linkProviderService: { linkProviders: ILinkProvider[] } } } };
    }
  )._core._linkifier.value._linkProviderService.linkProviders;
  const scan = async (): Promise<ILink[]> => {
    const answered: (ILink[] | undefined)[] = [];
    for (const provider of providers) provider.provideLinks(1, (links) => answered.push(links));
    await settled();
    return answered.flatMap((links) => links ?? []);
  };

  expect(await scan()).toEqual([]);
  expect((await scan()).map((link) => link.text)).toContain('src/x.ts');
});

test('a click that brings focus to the terminal opens nothing; then a click opens src/x.ts:12 and the modifier click asks for the other place', async () => {
  const tip = mountTip();
  const opens = vi.fn<LinkOpener>();
  const links = createLinks(...depsOver(tip, { open: opens, pathExists: async (absolute) => absolute === '/work/acme/src/x.ts' }));
  const engine = open(links.callbacks);
  links.install(engine);
  await write(engine, 'src/x.ts:12');

  engine.terminal.element?.dispatchEvent(mouse('mousedown', 32, 8));
  engine.terminal.element?.dispatchEvent(mouse('mouseup', 32, 8));
  expect(opens).not.toHaveBeenCalled();

  engine.terminal.focus();
  engine.terminal.element?.dispatchEvent(mouse('mousedown', 32, 8));
  engine.terminal.element?.dispatchEvent(mouse('mouseup', 32, 8));
  engine.terminal.element?.dispatchEvent(mouse('mousedown', 32, 8, { metaKey: true }));
  engine.terminal.element?.dispatchEvent(mouse('mouseup', 32, 8, { metaKey: true }));
  await settled();

  const file = { kind: 'path', link: fileAt({ path: '/work/acme/src/x.ts', line: 12, column: null }) };
  expect(opens.mock.calls).toEqual([
    [file, 'click'],
    [file, 'modified'],
  ]);
});

test('a click on a path whose check the server refuses opens nothing and hands the refusal on', async () => {
  const tip = mountTip();
  const opens = vi.fn<LinkOpener>();
  const refused = vi.fn<LinkRefused>();
  const refusal = new Error('the server answered place_path in a shape this window does not read');
  const links = createLinks(...depsOver(tip, { open: opens, refused, road: () => Promise.reject(refusal) }));
  const engine = open(links.callbacks);
  links.install(engine);
  await write(engine, 'src/x.ts');
  engine.terminal.focus();

  engine.terminal.element?.dispatchEvent(mouse('mousedown', 32, 8));
  engine.terminal.element?.dispatchEvent(mouse('mouseup', 32, 8));
  await settled();

  expect(opens).not.toHaveBeenCalled();
  expect(refused.mock.calls).toEqual([[refusal]]);
});

test('a directory git status names with a trailing slash opens as the link its road makes for that directory', async () => {
  const tip = mountTip();
  const opens = vi.fn<LinkOpener>();
  const directory: Link = { kind: 'directory', target: { absolute: '/work/acme/migrations', place: null } };
  const links = createLinks(
    ...depsOver(tip, { open: opens, road: async (path) => (path === '/work/acme/migrations' ? () => directory : null) }),
  );
  const engine = open(links.callbacks);
  links.install(engine);
  await write(engine, '?? migrations/');
  const providers = (
    engine.terminal as unknown as {
      _core: { _linkifier: { value: { _linkProviderService: { linkProviders: ILinkProvider[] } } } };
    }
  )._core._linkifier.value._linkProviderService.linkProviders;
  const answered: (ILink[] | undefined)[] = [];
  for (const provider of providers) provider.provideLinks(1, (provided) => answered.push(provided));
  await settled();
  expect(answered.flatMap((provided) => provided ?? []).map((link) => link.text)).toContain('migrations/');
  engine.terminal.focus();

  engine.terminal.element?.dispatchEvent(mouse('mousedown', 48, 8));
  engine.terminal.element?.dispatchEvent(mouse('mouseup', 48, 8));
  await settled();

  expect(opens.mock.calls).toEqual([[{ kind: 'path', link: directory }, 'click']]);
});

test('a right click on a link in the output asks for that link’s menu, and a right click elsewhere stays the terminal’s', async () => {
  const tip = mountTip();
  const menus = vi.fn<LinkMenu>();
  const links = createLinks(...depsOver(tip, { menu: menus }));
  const engine = open(links.callbacks);
  links.install(engine);
  await write(engine, 'https://example.com/ here');

  const elsewhere = mouse('contextmenu', 8 * 60, 8);
  engine.terminal.element?.dispatchEvent(elsewhere);
  engine.terminal.element?.dispatchEvent(mouse('contextmenu', 32, 8));

  expect(elsewhere.defaultPrevented).toBe(false);
  expect(menus.mock.calls).toEqual([
    [
      { kind: 'url', url: 'https://example.com/' },
      { x: 32, y: 8 },
    ],
  ]);
});

test('while the program tracks the mouse, a plain click stays the program’s and the modifier click does what a click does', async () => {
  const tip = mountTip();
  const opens = vi.fn<LinkOpener>();
  const links = createLinks(...depsOver(tip, { open: opens, pathExists: async (absolute) => absolute === '/work/acme/src/x.ts' }));
  const engine = open(links.callbacks);
  links.install(engine);
  await write(engine, '\x1b[?1000hsrc/x.ts');
  engine.terminal.focus();

  engine.terminal.element?.dispatchEvent(mouse('mousedown', 32, 8));
  engine.terminal.element?.dispatchEvent(mouse('mouseup', 32, 8));
  engine.terminal.element?.dispatchEvent(mouse('mousedown', 32, 8, { metaKey: true }));
  engine.terminal.element?.dispatchEvent(mouse('mouseup', 32, 8, { metaKey: true }));
  await settled();

  expect(opens.mock.calls).toEqual([[{ kind: 'path', link: fileAt({ path: '/work/acme/src/x.ts', line: null, column: null }) }, 'click']]);
});

test('hovering a web link shows where it opens, and leaving hides it', () => {
  const tip = mountTip();
  const links = createLinks(...depsOver(tip));

  links.callbacks.onLinkHover(mouse('mousemove', 0, 0), 'https://example.com/');
  flushSync();
  expect(tip.textContent).toContain('https://example.com/');
  expect(tip.style.display).toBe('');

  links.callbacks.onLinkLeave();
  expect(tip.style.display).toBe('none');
});

test('the tooltip carries the hover class xterm needs, and starts hidden', () => {
  const tip = mountTip();
  expect(tip.classList.contains('xterm-hover')).toBe(true);
  expect(tip.style.display).toBe('none');
});

test('references parse with line and column, and prose stays prose', () => {
  expect(parseFileRefs('src/x.ts:12')).toMatchObject([{ path: 'src/x.ts', line: 12, column: null }]);
  expect(parseFileRefs('a/b.ts:3:14')).toMatchObject([{ path: 'a/b.ts', line: 3, column: 14 }]);
  expect(parseFileRefs('see Makefile today')).toMatchObject([{ path: 'Makefile', line: null }]);
  expect(parseFileRefs('hello world')).toEqual([]);
  expect(parseFileRefs('see https://example.com/src/x.ts ok')).toEqual([]);
});

test('references resolve under the root, and escapes answer null', () => {
  expect(resolveFileRef({ path: 'src/x.ts', line: 12, column: null, start: 0, end: 11 }, '/work/acme')).toEqual({
    absolute: '/work/acme/src/x.ts',
    line: 12,
    column: null,
  });
  expect(resolveFileRef({ path: '../outside.ts', line: null, column: null, start: 0, end: 13 }, '/work/acme')).toBeNull();
  expect(resolveFileRef({ path: '~/x.ts', line: null, column: null, start: 0, end: 5 }, '/work/acme')).toBeNull();
  expect(resolveFileRef({ path: '/work/acme/a.ts', line: null, column: null, start: 0, end: 15 }, '/work/acme')).toEqual({
    absolute: '/work/acme/a.ts',
    line: null,
    column: null,
  });
});

test('an absolute reference outside the root is kept for the server to place, a relative escape is not', () => {
  expect(resolveFileRef({ path: '/work/other/a.ts', line: 3, column: null, start: 0, end: 16 }, '/work/acme')).toEqual({
    absolute: '/work/other/a.ts',
    line: 3,
    column: null,
  });
  expect(resolveFileRef({ path: '../other/a.ts', line: null, column: null, start: 0, end: 13 }, '/work/acme')).toBeNull();
});

test('URLs trim prose punctuation, keep unencoded paths, and stop at the bound', () => {
  expect(extractUrls('see (https://example.com/a). ok').map((link) => link.url)).toEqual(['https://example.com/a']);
  expect(extractUrls('see https://example.com/a. ok').map((link) => link.url)).toEqual(['https://example.com/a']);
  const decoded = extractUrls('see https://example.com/日本語 ok').map((link) => decodeURI(link.url));
  expect(decoded).toEqual(['https://example.com/日本語']);
  expect(extractUrls(`https://example.com/${'a'.repeat(3000)}`)).toEqual([]);
});

test('only the demanded modifier clicks', () => {
  const click = { metaKey: true, ctrlKey: false, button: 0 };
  expect(isDirectActivation(click, 'meta')).toBe(true);
  expect(isDirectActivation({ ...click, ctrlKey: true }, 'meta')).toBe(false);
  expect(isDirectActivation({ metaKey: false, ctrlKey: true, button: 0 }, 'ctrl')).toBe(true);
  expect(isDirectActivation({ ...click, button: 2 }, 'meta')).toBe(false);
  expect(isDirectActivation({ ...click, altKey: true }, 'meta')).toBe(false);
});

test('the hover cache clears behind typeof, and a throwing leave still invalidates', () => {
  const screen = document.createElement('div');
  screen.className = 'xterm-screen';
  const element = document.createElement('div');
  element.appendChild(screen);
  const leave = vi.fn(() => {
    throw new Error('a leave nobody guarded');
  });
  const linkifier = { _currentLink: {}, _lastBufferCell: {}, _activeLine: 3, _clearCurrentLink: leave } as {
    _currentLink: unknown;
    _lastBufferCell: unknown;
    _activeLine: number;
  };
  const terminal = {
    element,
    _core: { linkifier },
  } as unknown as Parameters<typeof resetHoverCache>[0];

  expect(isHoverActive(terminal)).toBe(true);
  resetHoverCache(terminal);

  expect(linkifier._currentLink).toBeUndefined();
  expect(linkifier._lastBufferCell).toBeUndefined();
  expect(linkifier._activeLine).toBe(-1);
  expect(isHoverActive(terminal)).toBe(false);
});

test('output arms one hover reset, deferred while a link is hovered', () => {
  const runs: (() => void)[] = [];
  const schedule: HoverSchedule = (run, ms) => {
    expect(ms).toBe(150);
    runs.push(run);
    return () => undefined;
  };
  let parsed: (() => void) | undefined;
  const linkifier: { _currentLink?: unknown } = {};
  const terminal = {
    element: null,
    onWriteParsed: (run: () => void) => {
      parsed = run;
      return { dispose: () => undefined };
    },
    _core: { linkifier },
  } as unknown as Parameters<typeof installHoverReset>[0];
  const tip = document.createElement('div');
  document.body.appendChild(tip);
  const release = installHoverReset(terminal, tip, schedule);

  parsed?.();
  parsed?.();
  expect(runs).toHaveLength(1);

  linkifier._currentLink = {};
  runs[0]?.();
  expect(runs).toHaveLength(2);
  expect(linkifier._currentLink).toBeDefined();

  release();
});
