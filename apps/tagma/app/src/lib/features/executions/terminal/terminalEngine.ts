import type { Host } from '@runlith/layer/Host';
import { FitAddon } from '@xterm/addon-fit';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import type { ITerminalAddon, ITerminalOptions } from '@xterm/xterm';
import { guardLinkProviderRegistration } from './engineGuards.js';
import { ligaturesEnabled, terminalFontFamily, terminalMinimumContrastRatio, type EngineOptions } from './engineOptions.js';

export interface Engine {
  readonly terminal: Terminal;
  readonly fit: FitAddon;
  readonly search: SearchAddon;
  readonly serialize: SerializeAddon;
  readonly unicode11: Unicode11Addon;
  readonly webLinks: WebLinksAddon;
  readonly ligatures: ITerminalAddon | null;
  setLigatures(enabled: boolean): void;
  onDispose(release: () => void): void;
  dispose(): void;
}

export const webglAddon = (): WebglAddon => new WebglAddon();

type TerminalWithCursor = Terminal & { readonly _core: { readonly coreService: { isCursorHidden: boolean } } };

export function openEngine(host: HTMLElement, options: EngineOptions, platform: Host): Engine {
  const terminal = new Terminal(engineOptions(options, platform));
  const cursor = (terminal as TerminalWithCursor)._core.coreService;
  let hidden = cursor.isCursorHidden;
  Object.defineProperty(cursor, 'isCursorHidden', {
    get: () => terminal.options.disableStdin || hidden,
    set: (value: boolean) => {
      hidden = value;
    },
  });
  guardLinkProviderRegistration(terminal);
  terminal.open(host);

  const fit = new FitAddon();
  const search = new SearchAddon();
  const serialize = new SerializeAddon();
  const unicode11 = new Unicode11Addon();
  const webLinks = new WebLinksAddon(options.onLinkClick ? (event, uri) => options.onLinkClick?.(event, uri) : undefined, {
    hover: (event, uri) => {
      if (uri) options.onLinkHover?.(event, uri);
    },
    leave: () => options.onLinkLeave?.(),
  });
  terminal.loadAddon(fit);
  terminal.loadAddon(search);
  terminal.loadAddon(serialize);
  terminal.loadAddon(unicode11);
  terminal.loadAddon(webLinks);
  terminal.unicode.activeVersion = '11';

  let ligatures = ligaturesEnabled(options.ligatures, options.fontFamily) ? loadLigatures(terminal) : null;
  options.attachWebgl?.(terminal);

  const releases: (() => void)[] = [];
  return {
    terminal,
    fit,
    search,
    serialize,
    unicode11,
    webLinks,
    get ligatures() {
      return ligatures;
    },
    setLigatures: (enabled) => {
      if (enabled === (ligatures !== null)) return;
      if (enabled) {
        ligatures = loadLigatures(terminal);
      } else {
        attempt(() => ligatures?.dispose());
        ligatures = null;
      }
      terminal.refresh(0, terminal.rows - 1);
    },
    onDispose: (release) => {
      releases.push(release);
    },
    dispose: () => {
      for (const release of releases.reverse()) attempt(release);
      releases.length = 0;
      for (const addon of [ligatures, search, serialize, unicode11, webLinks, fit]) {
        if (addon) attempt(() => addon.dispose());
      }
      attempt(() => terminal.clearSelection());
      attempt(() => terminal.dispose());
    },
  };
}

function attempt(step: () => void): void {
  try {
    step();
  } catch {}
}

function engineOptions(options: EngineOptions, platform: Host): ITerminalOptions {
  const cursorStyle = options.cursorStyle ?? 'block';
  return {
    allowProposedApi: true,
    allowTransparency: false,
    cursorBlink: options.cursorBlink ?? true,
    cursorStyle,
    cursorInactiveStyle: cursorStyle === 'block' ? 'outline' : cursorStyle,
    drawBoldTextInBrightColors: true,
    fastScrollSensitivity: options.fastScrollSensitivity ?? 5,
    fontFamily: terminalFontFamily(options.fontFamily),
    fontSize: options.fontSize ?? 14,
    fontWeight: options.fontWeight ?? 500,
    fontWeightBold: options.fontWeightBold ?? 700,
    lineHeight: options.lineHeight ?? 1,
    minimumContrastRatio: terminalMinimumContrastRatio(options.theme?.background, options.ground),
    scrollback: options.scrollback ?? 5000,
    scrollSensitivity: options.scrollSensitivity ?? 1.15,
    scrollbar: { width: 7 },
    vtExtensions: { kittyKeyboard: options.kittyKeyboard ?? true },
    ...(options.theme ? { theme: options.theme } : {}),
    wordSeparator: options.wordSeparator,
    ...(platform.apple
      ? {
          macOptionIsMeta: options.macOptionIsMeta ?? false,
          macOptionClickForcesSelection: true,
        }
      : {}),
  };
}

interface CachedRanges {
  readonly ranges: [number, number][];
  readonly size: number;
}

const LIGATURE_CACHE_CHARACTERS = 100_000;
const LIGATURE_CACHE_ENTRIES = 2_048;

class LigatureCache {
  private readonly entries = new Map<string, CachedRanges>();
  private characters = 0;
  generation = 0;

  read(text: string): [number, number][] | undefined {
    const entry = this.entries.get(text);
    if (!entry) return undefined;
    this.entries.delete(text);
    this.entries.set(text, entry);
    return entry.ranges.map(([start, end]): [number, number] => [start, end]);
  }

  write(text: string, ranges: readonly [number, number][]): void {
    if (text.length > LIGATURE_CACHE_CHARACTERS) return;
    const previous = this.entries.get(text);
    if (previous) {
      this.characters -= previous.size;
      this.entries.delete(text);
    }
    this.entries.set(text, { ranges: ranges.map(([start, end]): [number, number] => [start, end]), size: text.length });
    this.characters += text.length;
    while (this.characters > LIGATURE_CACHE_CHARACTERS || this.entries.size > LIGATURE_CACHE_ENTRIES) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.characters -= oldest[1].size;
    }
  }

  clear(): void {
    this.entries.clear();
    this.characters = 0;
    this.generation++;
  }
}

function loadLigatures(terminal: Terminal): ITerminalAddon {
  const inner = new LigaturesAddon();
  const cache = new LigatureCache();
  let family = terminal.options.fontFamily;

  const cached =
    (join: (text: string) => [number, number][]) =>
    (text: string): [number, number][] => {
      if (terminal.options.fontFamily !== family) {
        family = terminal.options.fontFamily;
        cache.clear();
      }
      const hit = cache.read(text);
      if (hit) return hit;
      const generation = cache.generation;
      const ranges = join(text);
      if (cache.generation === generation) cache.write(text, ranges);
      return ranges;
    };

  const stand = new Proxy(terminal, {
    get(target, property) {
      if (property === 'registerCharacterJoiner') {
        return (join: (text: string) => [number, number][]): number => target.registerCharacterJoiner(cached(join));
      }
      if (property === 'refresh') {
        return (start: number, end: number): void => {
          cache.clear();
          target.refresh(start, end);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const addon: ITerminalAddon = {
    activate: () => inner.activate(stand),
    dispose: () => {
      cache.clear();
      inner.dispose();
    },
  };
  terminal.loadAddon(addon);
  return addon;
}
