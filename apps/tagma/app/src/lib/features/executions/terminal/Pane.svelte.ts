import type { ITerminalOptions, ITheme, Terminal } from '@xterm/xterm';
import { ByteOffset, byteOffset, offsetValue } from '@runlith/executions/protocol/record';
import { Host } from '@runlith/layer/Host';
import { Process } from '@runlith/layer/process';
import { Scope } from '@runlith/layer/Scope';
import { mount, unmount, untrack } from 'svelte';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { refusalOf, retriable } from '$lib/wire/refusal.js';
import { siteLink } from '$lib/features/browser/links.js';
import { PathRoads } from '$lib/features/checkout/PathRoads.js';
import type { Link, LinkFrom } from '$lib/features/opening/Link.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { installGuards, newComposition } from './engineGuards.js';
import { loadEngine, loadedEngine } from './engineLoad.js';
import type { Engine } from './terminalEngine.js';
import type { DroppedPaths, FileDrop } from './fileDrop.js';
import { paneShell, pathInput } from './pathInput.js';
import { TerminalAppearance } from '../appearance/Settings.svelte.js';
import { TerminalFit, type FitFrames, type FitGrid, type FitObservation } from './Fit.js';
import { HOST_INPUT_ADMISSION_BYTES, TerminalInput, type Clipboard, type Clock, type HeldLane } from './Input.js';
import { TerminalKeymap, detectLayoutCategory, type LayoutCategory, type TerminalAct } from './Keymap.js';
import TerminalLinkTip from './LinkTip.svelte';
import { createLinks, type LinkModifier, type LinkPress, type LinkTip, type TerminalLink } from './links.js';
import { TerminalOutput, type PaneOutput, type Writer } from './Output.js';
import { TerminalRenderer } from './Renderer.js';
import { TerminalRenderPolicy, type RenderClock } from './RenderPolicy.js';
import {
  ScrollIntentStore,
  TerminalScrollIntent,
  blankViewport,
  paintsPrintableContent,
  type ScrollCapture,
} from './ScrollIntent.svelte.js';
import {
  RecordStream,
  recoveryPause,
  type ChildEnding,
  type RecordAim,
  type StreamFrame,
  type StreamWriter,
} from './RecordStream.svelte.js';
import { TerminalHolders, heldOf, type Held, type Holding } from './Holders.svelte.js';
import { ViewGrid } from './ViewGrid.js';
import { ExecutionsRepo, repoReads, terminalKey, type ExecutionAddress, type InputAct } from '../Repo.js';
import { openShell, readOperation, servable } from './Tab.svelte.js';

type Repo = ReturnType<typeof ExecutionsRepo.use>;

export type PaneGround = {
  readonly projectId: number;
  readonly root: string;
  visible(paneId: string): boolean;
  focused(paneId: string): boolean;
  ceiling(): FitGrid | null;
  noteBell(): void;
  close(paneId: string): void;
  perform(act: TerminalAct, pane: TerminalPane): boolean;
};

export type PaneBirth = {
  readonly id: string;
  readonly ground: PaneGround;
  readonly program: string;
};

export type PaneSource = { readonly _tag: 'Shell' } | { readonly _tag: 'Output'; readonly record: 'terminal' | 'command' };

export const SHELL: PaneSource = { _tag: 'Shell' };

export const sourceOf = (transport: 'pipes' | 'pty'): PaneSource => (transport === 'pty' ? SHELL : { _tag: 'Output', record: 'terminal' });

export type PaneBinding = {
  readonly born?: FitGrid | null;
  readonly agent?: string | null;
  readonly source?: PaneSource;
};

export interface PaneRefusal {
  readonly message: string;
}

export interface PaneLifecycleClock {
  now(): number;
  every(ms: number, run: () => Promise<void>): () => void;
}

export class TerminalPane extends Process<TerminalPane, PaneBirth>()('TerminalPane') {
  static override *make(birth: PaneBirth) {
    return new TerminalPane(
      birth.id,
      birth.ground,
      birth.program,
      yield* ExecutionsRepo,
      yield* Live,
      yield* PathRoads,
      yield* TerminalHolders,
      yield* TerminalOutput,
      yield* TerminalRenderPolicy,
      yield* TerminalKeymap,
      yield* TerminalAppearance,
      yield* Notices,
      yield* Host,
      yield* Opening,
      yield* Scope,
    );
  }

  title = $state('');
  label = $state<string | null>(null);
  cwd = $state<string | null>(null);
  ending = $state<ChildEnding | null>(null);
  endingDismissed = $state(false);
  problem = $state<string | null>(null);
  refusal = $state<PaneRefusal | null>(null);
  recovering = $state(false);
  searching = $state(false);
  address = $state<ExecutionAddress | null>(null);
  source = $state.raw<PaneSource>(SHELL);
  locating = $state(false);
  takingOver = $state(false);

  readonly scrollStore = new ScrollIntentStore();
  readonly view = crypto.randomUUID();

  private takeOverOperation: string | null = null;
  private told = $state.raw<{ readonly key: string; readonly held: Held } | null>(null);
  private boundKey: string | null = null;
  private dropTurn: Promise<void> = Promise.resolve();
  private files: FileDrop | null = null;
  private carried: HeldLane | null = null;
  private agent = $state<string | null>(null);
  private readonly served: ViewGrid;
  private readonly settledListeners = new Set<(grid: FitGrid) => void>();
  private settled: FitGrid | null = null;
  private recorded: { readonly key: string; readonly grid: FitGrid } | null = null;
  private layingPast = false;
  private box: HTMLElement | null = null;
  private boxes: HTMLElement[] = [];
  private readonly visibleBoxes = new Map<HTMLElement, boolean>();
  private readonly observations = new Map<HTMLElement, () => void>();
  private pageVisible = true;
  private root: HTMLDivElement | null = null;
  private surface: HTMLDivElement | null = null;
  private tip: HTMLElement | null = null;
  private tipApp: Record<string, unknown> | null = null;

  private engine: Engine | null = null;
  private renderer: TerminalRenderer | null = null;
  private intent: TerminalScrollIntent | null = null;
  private grid: TerminalFit | null = null;
  private retainedColumns = 0;
  private writer: Writer | null = null;
  private streamWriter: StreamWriter | null = null;

  replayedAt: number | null = $state(null);
  paintedAt: number | null = $state(null);
  replayedBytes: number = $state(0);
  replayedTotal: number | null = $state(null);
  private input: TerminalInput | null = null;
  private stream: RecordStream | null = null;
  private releases: (() => void)[] = [];
  private reparenting: ScrollCapture | null = null;
  private locateTimer: ReturnType<typeof setTimeout> | null = null;
  private remounting = false;
  private remountAttempts = 0;
  private remountedAt = Number.NEGATIVE_INFINITY;
  private frontier: ByteOffset = ByteOffset.make('0');
  private watchdogStop: (() => void) | null = null;
  private watchdogDelivered = 0;
  private watchdogSilent = 0;
  private watchdogHealing = false;
  private watchdogHealedAt = 0;
  private remountDelivered = 0;
  private quarantineArmedAt: number | null = null;
  private quarantineLastAt: number | null = null;
  private restartOperation: string | null = null;
  private restartBorn: FitGrid | null = null;
  private born: FitGrid | null = null;

  constructor(
    readonly id: string,
    private readonly ground: PaneGround,
    private readonly program: string,
    private readonly repo: Repo,
    private readonly live: LiveConnection,
    private readonly roads: PathRoads,
    private readonly holders: TerminalHolders,
    private readonly output: TerminalOutput,
    private readonly policy: TerminalRenderPolicy,
    private readonly keymap: TerminalKeymap,
    private readonly appearance: TerminalAppearance,
    private readonly notices: Notices,
    private readonly host: Host,
    private readonly opening: Opening,
    scope: Scope,
    private readonly lifecycle: PaneLifecycleClock = pageLifecycleClock,
  ) {
    super();
    this.title = program.split('/').pop() ?? program;
    this.served = new ViewGrid(
      live,
      ground.projectId,
      this.view,
      (grid) => this.resizeEngine({ cols: grid.columns, rows: grid.rows }),
      () => {
        const recorded = this.recordedGrid();
        return recorded === null ? null : { rows: recorded.rows, columns: recorded.cols };
      },
      () => {
        const ceiling = this.ground.ceiling();
        return ceiling === null ? null : { rows: ceiling.rows, columns: ceiling.cols };
      },
    );
    $effect(() => {
      if (!this.appearance.known) return;
      untrack(() => this.open());
    });
    scope.defer(() => this.dispose());
    this.policy.joinPage(this);
  }

  applyOptions(options: ITerminalOptions): void {
    const engine = this.engine;
    if (engine === null) return;
    Object.assign(engine.terminal.options, options);
    const wanted = this.appearance.ligaturesOn();
    if (wanted !== (engine.ligatures !== null)) {
      engine.setLigatures(wanted);
      this.renderer?.rebuild();
    }
    this.policy.changed(this);
  }

  applyTheme(theme: ITheme): void {
    if (this.engine !== null) this.engine.terminal.options.theme = theme;
  }

  hasBox(): boolean {
    const surface = this.surface;
    if (surface === null) return false;
    const rect = surface.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  fit(): void {
    this.grid?.requestFit();
  }

  get fill(): string {
    return this.appearance.paneFill;
  }
  private readonly boxStyle = $derived.by(() => {
    void this.appearance.paneBackground;
    return this.appearance.paneStyle();
  });
  get paddingX(): string {
    return `${this.boxStyle.paddingX}px`;
  }
  get paddingY(): string {
    return `${this.boxStyle.paddingY}px`;
  }

  measuredGrid(): FitGrid | null {
    const box = this.served.box;
    if (box !== null) return { cols: box.columns, rows: box.rows };
    const terminal = this.engine?.terminal;
    return terminal === undefined ? null : { cols: terminal.cols, rows: terminal.rows };
  }

  holdResize(): () => void {
    return this.grid?.hold() ?? (() => undefined);
  }

  chrome(): HTMLElement {
    const standing = this.root;
    if (standing !== null) return standing;
    const root = document.createElement('div');
    root.className = 'pane-chrome';
    const surface = document.createElement('div');
    surface.className = 'xterm-container';
    root.appendChild(surface);
    this.root = root;
    this.surface = surface;
    this.tipApp = mount(TerminalLinkTip, { target: root }) as Record<string, unknown>;
    this.tip = root.querySelector<HTMLElement>('[data-link-tip]');
    return root;
  }

  attach(box: HTMLElement): void {
    untrack(() => {
      this.boxes = [...this.boxes.filter((held) => held !== box), box];
      this.place(box);
      this.sighted();
    });
  }

  detach(box: HTMLElement): void {
    untrack(() => {
      const placed = this.box === box;
      this.boxes = this.boxes.filter((held) => held !== box);
      this.visibleBoxes.delete(box);
      if (!placed) return;
      this.unplace();
      const back = this.boxes.at(-1);
      if (back !== undefined) this.place(back);
      this.sighted();
    });
  }

  watchPlace(box: HTMLElement): () => void {
    return untrack(() => {
      this.visibility(box, false);
      const stop = this.policy.watchPlace(box, (visible) => this.visibility(box, visible));
      this.observations.set(box, stop);
      return () => {
        stop();
        this.observations.delete(box);
      };
    });
  }

  visibility(box: HTMLElement, visible: boolean): void {
    untrack(() => {
      this.visibleBoxes.set(box, visible);
      if (this.box !== box) return;
      this.reveal(visible);
    });
  }

  get visible(): boolean {
    return this.box !== null && this.visibleBoxes.get(this.box) !== false;
  }

  park(): void {
    if (this.engine === null) return;
    this.policy.unhide(this);
    this.carried = null;
    void this.input?.release();
    this.served.stop();
    this.watchdogStop?.();
    this.watchdogStop = null;
    this.reparenting = null;
    this.frontier = ByteOffset.make('0');
    this.policy.forget(this);
    this.closeEngine();
    this.retainedColumns = 0;
  }

  heldBytes(): number {
    const terminal = this.engine?.terminal;
    if (terminal === undefined) return 0;
    const lines = 2 * terminal.rows + (terminal.options.scrollback ?? DEFAULT_SCROLLBACK_ROWS);
    const storage = terminal.dynamicStorage!;
    const columns = Math.max(this.retainedColumns, terminal.cols);
    return lines * (columns * ENGINE_CELL_BYTES + ENGINE_LINE_BYTES) + 2 * storage.lineBytes + storage.linkBytes;
  }

  private sighted(): void {
    if (!this.visible || !this.ground.visible(this.id)) {
      if (this.engine !== null) this.policy.hide(this);
      this.suspendRenderer();
      return;
    }
    this.policy.unhide(this);
    if (!this.pageVisible) {
      this.suspendRenderer();
      return;
    }
    if (this.engine === null) this.open();
    else if (this.renderer?.suspended) this.policy.resume(this, () => (this.renderer === null ? [] : [this.renderer]));
  }

  private suspendRenderer(): void {
    if (this.renderer !== null && !this.renderer.suspended)
      this.policy.suspend(this, () => (this.renderer === null ? [] : [this.renderer]));
  }

  private place(box: HTMLElement): void {
    if (this.box === box) return;
    if (this.box !== null) this.unplace();
    const reopened = this.engine !== null;
    this.box = box;
    box.appendChild(this.chrome());
    if (!reopened) {
      if (this.visible && this.ground.visible(this.id) && this.pageVisible) this.open();
      return;
    }
    this.intent?.restoreAfterReparent(this.reparenting);
    this.reparenting = null;
    this.renderer?.reattach();
    this.grid?.requestFit();
  }

  private unplace(): void {
    if (this.box === null) return;
    this.box = null;
    this.reparenting = this.intent?.capture() ?? null;
    this.renderer?.disposeForReparent();
  }

  dismissEnding(): void {
    this.endingDismissed = true;
  }

  get watching(): boolean {
    return this.source._tag === 'Output';
  }

  get typable(): boolean {
    return !this.watching && this.ending === null;
  }

  get parked(): boolean {
    return this.engine === null;
  }

  get shown(): boolean {
    return this.box !== null;
  }

  bind(address: ExecutionAddress, binding: PaneBinding = {}): void {
    const born = binding.born ?? null;
    this.enterAddress(address);
    this.source = binding.source ?? SHELL;
    if (this.engine !== null) this.engine.terminal.options.convertEol = this.watching;
    if (binding.agent != null) this.agent = binding.agent;
    if (this.engine === null || this.writer === null) {
      if (this.address === null || terminalKey(this.address) !== terminalKey(address)) this.ending = null;
      this.address = address;
      this.born = born;
      return;
    }
    this.startWatchdog();
    void this.bindFrom(address, undefined, born);
  }

  end(ending: ChildEnding): void {
    if (this.ending !== null) return;
    this.settle(ending);
  }

  private settle(ending: ChildEnding): void {
    this.ending = ending;
    this.endingDismissed = false;
    this.recovering = false;
    this.served.stop();
    this.grid?.requestFit();
    if (this.watching) this.input?.observe();
    else this.input?.detach();
    this.dismissRefusal();
  }

  private bindFrom(address: ExecutionAddress, from?: ByteOffset, born: FitGrid | null = null): Promise<void> {
    const standing = this.address;
    const moved = standing === null || standing.execution !== address.execution || standing.incarnation !== address.incarnation;
    if (moved) this.frontier = ByteOffset.make('0');
    if (standing !== null && moved) this.ending = null;
    this.enterAddress(address);
    this.address = address;
    this.born = born;
    const done = this.subscribe(address, moved ? undefined : from);
    const drawn = this.served.drawn();
    const start = drawn === null ? born : { cols: drawn.columns, rows: drawn.rows };
    if (start !== null) this.resizeEngine(start);
    return done;
  }

  private enterAddress(address: ExecutionAddress): void {
    const key = terminalKey(address);
    if (this.boundKey === key) return;
    this.boundKey = key;
    this.carried = null;
    this.agent = null;
    this.takeOverOperation = null;
  }

  get holder(): Holding | null {
    const address = this.address;
    if (address === null || this.watching) return null;
    const standing = this.holders.of(address);
    const told = this.told !== null && this.told.key === terminalKey(address) ? this.told : null;
    const known = told === null || (standing !== undefined && standing.revision >= told.held.revision) ? standing : told.held;
    const thread = known === undefined ? this.agent : known.holder;
    return thread === null ? null : this.holders.holding(thread);
  }

  heldBy(address: ExecutionAddress, held: Held): void {
    const key = terminalKey(address);
    const standing = this.told;
    if (standing !== null && standing.key === key && standing.held.revision > held.revision) return;
    this.told = { key, held };
  }

  private async readHeld(address: ExecutionAddress, key: string): Promise<Held | undefined> {
    let listing;
    try {
      listing = await this.repo.record.key(address).refresh({ throwOnError: true });
    } catch {
      return undefined;
    }
    if (listing === undefined || this.boundKey !== key) return undefined;
    const record = listing.record;
    return heldOf(record);
  }

  async takeOver(): Promise<void> {
    const address = this.address;
    if (address === null || this.takingOver) return;
    const key = terminalKey(address);
    this.takingOver = true;
    try {
      const retained = this.takeOverOperation;
      if (retained !== null && (await this.readBackTakeOver(retained, address, key))) return;
      if (this.boundKey !== key) return;
      const operationId = crypto.randomUUID();
      this.takeOverOperation = operationId;
      let answer;
      try {
        answer = await this.repo.takeOver.run({ ...address, operationId }, { throwOnError: true });
      } catch (error) {
        if (this.boundKey !== key) return;
        if (retriable(refusalOf(error)) && (await this.readBackTakeOver(operationId, address, key))) return;
        this.takeOverOperation = null;
        if (this.boundKey === key) this.noteProblem(wordsOf(error));
        return;
      }
      if (answer === undefined || this.boundKey !== key) return;
      if (answer._tag === 'Moved') {
        this.tookOver(key, answer.revision);
        return;
      }
      if (await this.readBackTakeOver(operationId, address, key)) return;
      this.takeOverOperation = null;
      if (this.boundKey === key) this.noteProblem('Take over did not move this terminal.');
    } finally {
      this.takingOver = false;
    }
  }

  private async readBackTakeOver(operationId: string, address: ExecutionAddress, key: string): Promise<boolean> {
    for (let attempt = 0; ; attempt += 1) {
      const stood = await readOperation(this.repo, operationId);
      if (this.boundKey !== key) return true;
      if (stood._tag === 'Landed') {
        this.takeOverOperation = null;
        await this.settledTakeOver(address, key);
        return true;
      }
      if (stood._tag === 'Free') return false;
      await recoveryPause(attempt);
      if (this.boundKey !== key) return true;
    }
  }

  private async settledTakeOver(address: ExecutionAddress, key: string): Promise<void> {
    const held = await this.readHeld(address, key);
    if (held === undefined) {
      this.noteProblem('Take over was decided, but who holds this terminal now could not be read.');
      return;
    }
    if (held.holder === null) {
      this.tookOver(key, held.revision);
      return;
    }
    this.agent = held.holder;
    this.heldBy(address, held);
    this.noteProblem('Take over did not move this terminal; its agent still holds it.');
  }

  private tookOver(key: string, revision: number): void {
    this.takeOverOperation = null;
    const address = this.address;
    if (this.boundKey !== key || address === null) return;
    this.agent = null;
    this.heldBy(address, { holder: null, revision });
    this.input?.renew();
  }

  private typeInto(address: ExecutionAddress): void {
    const input = this.input;
    if (input === null) return;
    if (this.watching) {
      input.observe();
      return;
    }
    if (this.ending !== null) return;
    const carried = this.carried;
    this.carried = null;
    input.attach(address, this.view, carried);
    this.served.follow(address);
  }

  private resizeEngine(grid: FitGrid): void {
    const terminal = this.engine?.terminal;
    if (terminal === undefined || (terminal.cols === grid.cols && terminal.rows === grid.rows)) return;
    this.retainedColumns = Math.max(this.retainedColumns, terminal.cols, grid.cols);
    const captured = this.intent?.capture();
    try {
      terminal.resize(grid.cols, grid.rows);
    } catch {
    } finally {
      if (captured !== undefined) this.intent?.restore(captured);
    }
    this.renderer?.afterFit();
    this.policy.changed(this);
  }

  private subscribe(address: ExecutionAddress, from?: ByteOffset): Promise<void> {
    this.typeInto(address);
    this.stream?.stop();
    const writer = this.streamWriter;
    if (writer === null) return Promise.resolve();
    const stream = new RecordStream(
      repoReads(this.repo),
      this.live,
      this.ground.projectId,
      address,
      this.aim(),
      writer,
      (frame) => this.onFrame(frame),
      {
        scrollbackRows: this.engine?.terminal.options.scrollback ?? DEFAULT_SCROLLBACK_ROWS,
        progress: (written, total) => {
          this.replayedBytes = written;
          this.replayedTotal = total;
        },
      },
    );
    this.stream = stream;
    const done = from === undefined ? stream.start() : stream.reread(from);
    return done.then(() => {
      this.replayedAt ??= performance.now();
    });
  }

  private aim(): RecordAim {
    const source = this.source;
    if (source._tag === 'Shell') return { kind: 'terminal', stream: 'pty' };
    return source.record === 'terminal' ? { kind: 'terminal', stream: 'output' } : { kind: 'command', stream: 'output' };
  }

  async restart(): Promise<void> {
    if (this.ending === null || this.watching) return;
    this.dismissRefusal();
    this.armQuarantine();
    const born = this.restartOperation === null ? servable(this.measuredGrid(), this.ground.ceiling()) : this.restartBorn;
    const outcome = await openShell(this.repo, this.cwd ?? this.ground.root, this.restartOperation, born);
    this.restartOperation = outcome.retain;
    this.restartBorn = outcome.retain === null ? null : born;
    if (outcome._tag !== 'Started') {
      this.disarmQuarantine();
      this.noteProblem(outcome._tag === 'Unanswered' ? outcome.problem : wordsOf(outcome.error));
      return;
    }
    this.ending = null;
    this.bind(outcome.execution, { born });
  }

  closePane(): void {
    this.ground.close(this.id);
  }

  dismissRefusal(): void {
    this.refusal = null;
    this.problem = null;
  }

  noteProblem(message: string): void {
    this.noteRefusal({ message });
  }

  reveal(visible: boolean): void {
    this.writer?.focus(visible && this.visible && this.pageVisible);
    this.sighted();
    if (!visible || !this.visible) return;
    this.grid?.reveal();
  }

  focus(): void {
    this.engine?.terminal.focus();
  }

  clear(): void {
    this.intent?.clear();
  }

  selectAll(): void {
    this.engine?.terminal.selectAll();
  }

  scrollTo(edge: 'top' | 'bottom'): void {
    this.intent?.jump(edge);
  }

  copy(): Promise<boolean> {
    return this.input?.copy() ?? Promise.resolve(false);
  }

  paste(text?: string): Promise<boolean> {
    const input = this.input;
    if (input === null) return Promise.resolve(false);
    if (text !== undefined) return input.paste(text);
    const files = this.files;
    if (files === null) return input.pasteFromClipboard();
    let settle: (answer: DroppedPaths) => void = () => undefined;
    const landing = this.pasteDropped(new Promise<DroppedPaths>((done) => (settle = done)));
    return input
      .pasteFromClipboard(async (held) => {
        settle(await files([pictureFile(held)]));
        await landing;
        return true;
      })
      .finally(() => settle({ paths: [], problems: [] }));
  }

  takeFiles(files: FileDrop): () => void {
    this.files = files;
    return () => {
      if (this.files === files) this.files = null;
    };
  }

  pasteDropped(dropped: Promise<DroppedPaths>): Promise<void> {
    const key = this.boundKey;
    const turn = this.dropTurn.then(() => dropped).then((answer) => this.landDropped(key, answer));
    this.dropTurn = turn;
    return turn;
  }

  pastePaths(paths: readonly string[]): void {
    void this.pasteDropped(Promise.resolve({ paths, problems: [] }));
  }

  private landDropped(key: string | null, answer: DroppedPaths): void {
    const input = this.input;
    if (answer.paths.length > 0 && (this.boundKey !== key || !this.typable || input === null)) {
      this.noteProblem('The terminal moved on before the dropped file was ready, so its path was not typed.');
      return;
    }
    const typed = pathInput(answer.paths, paneShell(this.program));
    const problems = [...answer.problems];
    if (typed.refused > 0)
      problems.push('A name with a line break or another control character cannot be typed as a path, so it was left out.');
    if (problems.length > 0) this.noteProblem(problems.join(' '));
    if (input === null || typed.pieces.length === 0) return;
    void input.pasteEach(typed.pieces, ' ').then((taken) => {
      if (!taken && this.input === input) this.noteProblem('The terminal did not take the dropped path in time, so it was not typed.');
    });
  }

  get search(): Engine['search'] | null {
    return this.engine?.search ?? null;
  }

  get rendering(): TerminalRenderer | null {
    return this.renderer;
  }

  locate(): void {
    if (this.locateTimer !== null) clearTimeout(this.locateTimer);
    this.locating = true;
    this.locateTimer = setTimeout(() => {
      this.locateTimer = null;
      this.locating = false;
    }, LOCATE_FLASH_MS);
  }

  private open(): void {
    const surface = this.surface;
    if (surface === null || this.engine !== null || !this.visible || !this.ground.visible(this.id) || !this.pageVisible) return;
    if (!this.appearance.known) return;
    const kit = loadedEngine();
    if (kit === null)
      return void loadEngine().then(
        () => this.open(),
        () => this.noteProblem('The terminal engine did not load; reload the window to open this terminal.'),
      );
    const renderer = new TerminalRenderer(this.policy, kit.webglAddon, pageRenderClock, () => this.grid?.requestFit());
    const links = createLinks(
      this.tip ?? surface,
      (link, press) => this.openLink(link, press),
      (link, tracking) => this.tipOf(link, tracking),
      (link, at) => this.opening.menu(this.linkOf(link), at),
      this.roads.road(this.linkFrom()),
      (error) => this.notices.refusal(error),
      this.ground.root,
      linkModifier(this.host),
    );
    const engine = kit.openEngine(
      surface,
      {
        ...this.appearance.options(this.id),
        onLinkClick: links.callbacks.onLinkClick,
        onLinkHover: links.callbacks.onLinkHover,
        onLinkLeave: links.callbacks.onLinkLeave,
        attachWebgl: (terminal) => renderer.open(terminal),
      },
      this.host,
    );
    this.engine = engine;
    engine.terminal.options.convertEol = this.watching;
    this.renderer = renderer;

    const composition = newComposition();
    installGuards(engine, {
      wheelSensitivity: () => this.appearance.wheelSensitivity(),
      shaping: () => renderer.attached,
      now: () => Date.now(),
      mouseHideWhileTyping: () => this.appearance.mouseHideWhileTyping(),
      composition,
    });
    links.install(engine);

    const intent = new TerminalScrollIntent(engine, this.scrollStore, {
      onProblem: (problem) => this.noteProblem(problem),
    });
    this.intent = intent;
    const grid = new TerminalFit(
      engine,
      pageFrames,
      (callback) => new ResizeObserver(callback) as FitObservation,
      () => this.applyParked(),
      {
        measured: (box) => {
          if (this.watching || this.ending !== null) this.resizeEngine(box);
          else this.served.measured({ rows: box.rows, columns: box.cols });
          renderer.afterFit();
        },
      },
    );
    this.grid = grid;
    const writer = this.output.register(engine.terminal, this.reporting());
    this.writer = writer;
    this.streamWriter = {
      write: (bytes, parsed, at) => {
        this.paintedAt ??= performance.now();
        this.noteDelivered(bytes, at);
        writer.write(bytes, parsed, at);
      },
      grid: (grid) => this.laidOut({ cols: grid.columns, rows: grid.rows }),
      screen: (bytes, at, parsed) => {
        this.paintedAt ??= performance.now();
        this.noteDelivered(bytes, undefined);
        this.frontier = at;
        writer.screen(bytes, parsed);
      },
      replaying: (on) => {
        writer.replaying(on);
        this.replaying(on);
      },
    };
    const appearance = this.appearance;
    const input = new TerminalInput(
      engine,
      this.repo,
      this.keymap,
      pageClipboard,
      pageClock,
      this.live,
      writer,
      this.ground.projectId,
      HOST_INPUT_ADMISSION_BYTES,
      {
        get osc52() {
          return appearance.osc52();
        },
        replaying: () => writer.replayInFlight(),
        onProblem: (problem) => {
          if (this.ending === null) this.noteProblem(problem);
        },
        onEnded: () => void this.stream?.verify(),
        composition,
        candidateKeysArrivePlain: this.host.os === 'linux',
        beforeSend: (act) => this.quarantinedInput(act),
        focused: () => document.hasFocus() && engine.terminal.textarea !== undefined && engine.terminal.textarea === document.activeElement,
      },
    );
    input.onAct((act) => this.ground.perform(act, this));
    this.input = input;

    this.releases.push(this.policy.join(renderer));
    this.releases.push(this.appearance.register(this));
    this.watch(engine, input);
    grid.attach(surface);

    const address = this.address;
    if (address !== null) this.bind(address, { born: this.born, agent: this.agent, source: this.source });
    this.sighted();
  }

  onSettled(listener: (grid: FitGrid) => void): () => void {
    this.settledListeners.add(listener);
    return () => {
      this.settledListeners.delete(listener);
    };
  }

  private recordedGrid(): FitGrid | null {
    const recorded = this.recorded;
    const address = this.address;
    return recorded !== null && address !== null && recorded.key === terminalKey(address) ? recorded.grid : null;
  }

  private laidOut(grid: FitGrid): void {
    const address = this.address;
    if (address === null) return;
    this.recorded = { key: terminalKey(address), grid };
    this.served.laid();
    if (!this.layingPast) this.tellSettled();
  }

  private replaying(on: boolean): void {
    this.layingPast = on;
    if (!on) this.tellSettled();
  }

  private tellSettled(): void {
    const grid = this.recordedGrid();
    const settled = this.settled;
    if (grid === null || this.ending !== null) return;
    if (settled !== null && settled.cols === grid.cols && settled.rows === grid.rows) return;
    this.settled = grid;
    for (const listener of [...this.settledListeners]) listener(grid);
  }

  private reporting(): PaneOutput {
    return {
      onBell: () => this.ground.noteBell(),
      onRetained: () => this.policy.changed(this),
      visible: () => this.visible && this.ground.visible(this.id) && this.pageVisible,
      focused: () => this.ground.focused(this.id),
      webgl: () => this.renderer?.attached === true,
      scrollbackRows: () => this.engine?.terminal.options.scrollback ?? DEFAULT_SCROLLBACK_ROWS,
      reread: (from: ByteOffset) => this.stream?.reread(from),
      dead: () => this.remount(),
      unavailable: () => this.remount(),
    };
  }

  private noteDelivered(bytes: Uint8Array, at: ByteOffset | undefined): void {
    this.watchdogDelivered += 1;
    if (this.remounting) this.remountDelivered += 1;
    if (at === undefined) return;
    const end = offsetValue(at) + BigInt(bytes.length);
    if (end > offsetValue(this.frontier)) this.frontier = byteOffset(end);
  }

  private quarantinedInput(act: InputAct): InputAct {
    if (this.quarantineVerdict(act) === 'pass') return act;
    return { _tag: 'Write', bytes: '' };
  }

  private quarantineVerdict(act: InputAct): 'pass' | 'drop' {
    const armedAt = this.quarantineArmedAt;
    if (armedAt === null) return 'pass';
    if (act._tag !== 'Write') {
      if (act._tag === 'Interrupt') this.quarantineArmedAt = null;
      return 'pass';
    }
    const now = this.lifecycle.now();
    if (now - armedAt >= QUARANTINE_MAX_MS) {
      this.quarantineArmedAt = null;
      return 'pass';
    }
    if (now - (this.quarantineLastAt ?? armedAt) >= QUARANTINE_IDLE_MS) {
      this.quarantineArmedAt = null;
      return 'pass';
    }
    this.quarantineLastAt = now;
    if (LINE_TERMINATOR_RE.test(atob(act.bytes))) this.quarantineArmedAt = null;
    return 'drop';
  }

  private armQuarantine(): void {
    this.quarantineArmedAt = this.lifecycle.now();
    this.quarantineLastAt = null;
  }

  private disarmQuarantine(): void {
    this.quarantineArmedAt = null;
    this.quarantineLastAt = null;
  }

  private startWatchdog(): void {
    if (this.watchdogStop !== null) return;
    this.watchdogStop = this.lifecycle.every(WATCHDOG_INTERVAL_MS, () => this.watchdogTick().catch(() => undefined));
  }

  private async watchdogTick(): Promise<void> {
    if (this.watchdogHealing) return;
    const address = this.address;
    const stream = this.stream;
    if (address === null || stream === null || this.engine === null || this.ending !== null) return;
    if (this.watchdogDelivered > 0) {
      this.watchdogDelivered = 0;
      this.watchdogSilent = 0;
      return;
    }
    let moved: boolean;
    try {
      moved = await stream.behind(this.frontier);
    } catch {
      return;
    }
    if (!moved) {
      this.watchdogSilent = 0;
      return;
    }
    this.watchdogSilent += 1;
    if (this.watchdogSilent < WATCHDOG_STALL_TICKS) return;
    const now = this.lifecycle.now();
    if (now - this.watchdogHealedAt < WATCHDOG_HEAL_COOLDOWN_MS) return;
    this.watchdogHealedAt = now;
    this.watchdogSilent = 0;
    this.watchdogHealing = true;
    try {
      await stream.reread(this.resumeAt());
    } catch {
    } finally {
      this.watchdogHealing = false;
    }
  }

  pageHide(): void {
    this.pageVisible = false;
    this.sighted();
  }

  pageReveal(): void {
    this.pageVisible = true;
    this.sighted();
    if (!this.visible || !this.ground.visible(this.id)) return;
    this.grid?.reveal();
    this.writer?.focus(true);
  }

  private watch(engine: Engine, input: TerminalInput): void {
    const terminal = engine.terminal;
    const held: { dispose(): void }[] = [
      terminal.onTitleChange((title) => this.entitle(title)),
      terminal.parser.registerOscHandler(OSC_WORKING_DIRECTORY, (data) => {
        const cwd = parseWorkingDirectory(data);
        if (cwd !== null) this.cwd = cwd;
        return false;
      }),
    ];
    let bracketed = terminal.modes.bracketedPasteMode;
    input.setBracketedPaste(bracketed);
    held.push(
      terminal.onWriteParsed(() => {
        if (terminal.modes.bracketedPasteMode === bracketed) return;
        bracketed = terminal.modes.bracketedPasteMode;
        input.setBracketedPaste(bracketed);
      }),
    );
    for (const listener of held) this.releases.push(() => listener.dispose());

    void readLayoutCategory().then((layout) => {
      if (this.input === input) input.setKeyContext({ layout });
    });

    const element = terminal.element;
    if (element === null || element === undefined) return;
    const onSelectionEnd = (): void => {
      if (!this.appearance.clipboardOnSelect()) return;
      const selection = terminal.getSelection();
      if (selection !== '') void pageClipboard.writeText(selection).catch(() => undefined);
    };
    const onContextMenu = (event: MouseEvent): void => {
      if (!this.appearance.rightClickToPaste()) return;
      event.preventDefault();
      void this.paste();
    };
    const onFocus = (): void => input.focused();
    element.addEventListener('pointerup', onSelectionEnd);
    element.addEventListener('contextmenu', onContextMenu);
    element.addEventListener('focusin', onFocus);
    this.releases.push(() => {
      element.removeEventListener('pointerup', onSelectionEnd);
      element.removeEventListener('contextmenu', onContextMenu);
      element.removeEventListener('focusin', onFocus);
    });
  }

  private applyParked(): void {
    const engine = this.engine;
    const parked = this.appearance.parked(this);
    if (engine === null || parked === undefined) return;
    Object.assign(engine.terminal.options, parked);
  }

  private remount(): void {
    if (this.remounting) return;
    const box = this.box;
    const engine = this.engine;
    const address = this.address;
    if (box === null || engine === null || address === null) return;
    const now = this.lifecycle.now();
    if (now - this.remountedAt >= REMOUNT_WINDOW_MS) this.remountAttempts = 0;
    if (this.remountAttempts >= REMOUNT_ATTEMPTS) {
      this.noteProblem('This terminal stopped painting, and three fresh engines in a row did not bring it back.');
      return;
    }
    this.remountAttempts += 1;
    this.remountedAt = now;
    this.remounting = true;
    const scrollback = engine.terminal.options.scrollback;
    const cols = engine.terminal.cols;
    const rows = engine.terminal.rows;
    this.carried = this.input?.lane() ?? null;
    if (this.carried === null) void this.input?.release();
    this.closeEngine();
    this.address = null;
    this.open();
    const fresh = this.engine;
    const grid = this.grid;
    const intent = this.intent;
    if (fresh === null || grid === null || intent === null) {
      this.address = address;
      this.remounting = false;
      return;
    }
    if (scrollback !== undefined) fresh.terminal.options.scrollback = scrollback;
    if (cols > 0 && rows > 0) {
      try {
        fresh.terminal.resize(cols, rows);
      } catch {}
    }
    const releaseFit = grid.holdForRebuild();
    this.frontier = ByteOffset.make('0');
    this.remountDelivered = 0;
    void intent
      .bracketRebuild(async () => {
        if (rows > 0) fresh.terminal.write(blankViewport(rows));
        await this.bindFrom(address, undefined, this.born);
      })
      .catch(() => undefined)
      .finally(() => {
        releaseFit();
        this.remounting = false;
        this.refuseEmptyRestore();
      });
  }

  private refuseEmptyRestore(): void {
    const engine = this.engine;
    const stream = this.stream;
    if (engine === null || stream === null || this.remountDelivered === 0) return;
    if (paintsBuffer(engine.terminal)) return;
    void stream.reread(this.resumeAt()).catch(() => undefined);
  }

  private resumeAt(): ByteOffset {
    const at = offsetValue(this.frontier) - BigInt(this.writer?.pending() ?? 0);
    return byteOffset(at < 0n ? 0n : at);
  }

  private onFrame(frame: StreamFrame): void {
    if (frame._tag === 'Ended') {
      this.settle(frame.ending);
      return;
    }
    this.recovering = frame._tag === 'Recovering' && this.ending === null;
  }

  private noteRefusal(next: PaneRefusal): void {
    this.refusal = { message: next.message };
    this.problem = next.message;
  }

  private entitle(title: string): void {
    const trimmed = title.trim();
    this.title = trimmed === '' ? (this.program.split('/').pop() ?? this.program) : trimmed;
  }

  private linkFrom(): LinkFrom {
    return { project: this.ground.projectId, quiet: true };
  }

  private linkOf(link: TerminalLink): Link {
    return link.kind === 'url' ? siteLink(link.url, this.linkFrom()) : link.link;
  }

  private openLink(link: TerminalLink, press: LinkPress): void {
    void this.opening.open(this.linkOf(link), this.opening.how(press === 'modified'));
  }

  private tipOf(link: TerminalLink, tracking: boolean): LinkTip {
    const tip = this.opening.tip(this.linkOf(link));
    const hints = tip.hints ?? [];
    const first = hints[0];
    return {
      text: tip.text ?? '',
      hints: tracking ? (first === undefined ? [] : [{ keys: this.opening.keys(true), words: first.words }]) : hints,
    };
  }

  private closeEngine(): void {
    this.stream?.stop();
    this.stream = null;
    this.streamWriter = null;
    this.input?.detach();
    this.input = null;
    this.writer?.dispose();
    this.writer = null;
    this.grid?.detach();
    this.grid = null;
    this.intent?.dispose();
    this.intent = null;
    for (const release of this.releases.splice(0).reverse()) {
      try {
        release();
      } catch {}
    }
    this.renderer?.destroy();
    this.renderer = null;
    this.engine?.dispose();
    this.engine = null;
  }

  private dispose(): void {
    this.policy.unhide(this);
    this.policy.forget(this);
    this.policy.forget(this.ground);
    for (const stop of this.observations.values()) stop();
    this.observations.clear();
    this.visibleBoxes.clear();
    this.boxes = [];
    this.box = null;
    if (this.locateTimer !== null) clearTimeout(this.locateTimer);
    this.locateTimer = null;
    this.served.stop();
    this.policy.leavePage(this);
    this.watchdogStop?.();
    this.watchdogStop = null;
    void this.input?.release();
    this.closeEngine();
    const tipApp = this.tipApp;
    this.tipApp = null;
    if (tipApp !== null) void unmount(tipApp);
    this.root?.remove();
    this.root = null;
    this.surface = null;
    this.tip = null;
  }
}

const LOCATE_FLASH_MS = 1_500;
const WATCHDOG_INTERVAL_MS = 15_000;
const WATCHDOG_STALL_TICKS = 2;
const WATCHDOG_HEAL_COOLDOWN_MS = 60_000;
const QUARANTINE_IDLE_MS = 100;
const QUARANTINE_MAX_MS = 5_000;
const REMOUNT_ATTEMPTS = 3;
const REMOUNT_WINDOW_MS = 60_000;
const LINE_TERMINATOR_RE = /[\r\n\x03]/;
const DEFAULT_SCROLLBACK_ROWS = 5_000;
const ENGINE_CELL_BYTES = 16;
const ENGINE_LINE_BYTES = 256;
const OSC_WORKING_DIRECTORY = 7;

export function linkModifier(host: Host): LinkModifier {
  return host.apple ? 'meta' : 'ctrl';
}

export function parseWorkingDirectory(data: string): string | null {
  const match = /^file:\/\/[^/]*(\/.*)$/.exec(data);
  if (match?.[1] === undefined) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (path === '') return null;
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path;
}

const pageFrames: FitFrames = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

const pageRenderClock: RenderClock = {
  ...pageFrames,
  delay: (callback, ms) => setTimeout(callback, ms) as unknown as number,
  now: () => Date.now(),
};

const PICTURE_EXTENSIONS: Readonly<Record<string, string>> = { 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' };

function pictureFile(held: Blob): File {
  return new File([held], `clipboard.${PICTURE_EXTENSIONS[held.type] ?? held.type.slice('image/'.length)}`, { type: held.type });
}

const pageClipboard: Clipboard = {
  readText: () => navigator.clipboard.readText(),
  readPicture: async () => {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((held) => held.startsWith('image/'));
      if (type !== undefined) return item.getType(type);
    }
    return null;
  },
  writeText: (text) => navigator.clipboard.writeText(text),
};

const pageClock: Clock = { wait: (ms) => new Promise<void>((done) => setTimeout(done, ms)), now: () => Date.now() };

const pageLifecycleClock: PaneLifecycleClock = {
  now: () => Date.now(),
  every: (ms, run) => {
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  },
};

function paintsBuffer(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active;
  const rows: string[] = [];
  const total = buffer.baseY + terminal.rows;
  for (let row = 0; row < total; row += 1) {
    rows.push(buffer.getLine(row)?.translateToString(true) ?? '');
  }
  return paintsPrintableContent(rows.join('\n'));
}

function wordsOf(error: unknown): string {
  return refusalOf(error).told.text;
}

async function readLayoutCategory(): Promise<LayoutCategory> {
  const keyboard = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  if (keyboard?.getLayoutMap === undefined) return 'unknown';
  try {
    return detectLayoutCategory(await keyboard.getLayoutMap());
  } catch {
    return 'unknown';
  }
}
