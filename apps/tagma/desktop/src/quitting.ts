import { type BrowserWindow, Menu, type MenuItemConstructorOptions, app, dialog, powerMonitor } from 'electron';
import { CHANNEL } from './channel.js';
import { type Leaving, stopAll, stopIdle } from './leaving.js';
import { machineWork, type Refusal, type Work } from './server.js';
import { tell } from './telling.js';

const counted = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

const REACHED = `Claude Code and Codex stop reaching ${CHANNEL.name} until you open it again.`;

const stopping = (work: Work | null): string => {
  if (work === null)
    return `${CHANNEL.name} couldn't tell what is running. Stopping ends all of it: agents at work, terminals and commands, and anything it records.\n${REACHED}`;
  const ran = (work.terminals ?? 0) + (work.commands ?? 0);
  const lines = [
    work.agents === 0 ? null : `${counted(work.agents, 'agent at work stops', 'agents at work stop')}.`,
    work.terminals === null || work.commands === null
      ? 'Every terminal and command it runs ends.'
      : ran === 0
        ? null
        : `${counted(ran, 'terminal or command ends', 'terminals and commands end')}.`,
    ...(work.live === null
      ? ['Anything it records ends.']
      : work.live.filter((one) => one.count > 0).map((one) => `${counted(one.count, one.one, one.many)}.`)),
    REACHED,
  ];
  return lines.filter((line) => line !== null).join('\n');
};

export class Quitting {
  private state: 'open' | 'quitting' | 'leaving' = 'open';
  private system = false;

  constructor(
    private readonly surfaceUrl: URL,
    private readonly places: Leaving | null,
    private readonly windows: () => readonly BrowserWindow[],
    private readonly parent: () => BrowserWindow | undefined,
    private readonly report: () => void,
    private readonly checkForUpdates: () => void,
    private readonly ending: () => void,
    private readonly view: readonly MenuItemConstructorOptions[],
  ) {}

  install(): void {
    app.on('before-quit', (event) => {
      if (this.state === 'leaving' || this.system) return;
      event.preventDefault();
      if (this.state === 'quitting') return;
      this.state = 'quitting';
      void this.quit();
    });
    powerMonitor.on('shutdown', () => {
      this.system = true;
    });
    const stop: MenuItemConstructorOptions[] =
      this.places === null ? [] : [{ label: `Stop ${CHANNEL.name}…`, click: () => void this.stop() }];
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          role: 'appMenu',
          submenu: [
            { role: 'about' },
            { label: 'Check for Updates…', click: () => this.checkForUpdates() },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            ...stop,
            { role: 'quit' },
          ],
        },
        { role: 'fileMenu' },
        { role: 'editMenu' },
        this.view.length === 0
          ? { role: 'viewMenu' }
          : {
              label: 'View',
              submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { type: 'separator' },
                ...this.view,
              ],
            },
        { role: 'windowMenu' },
        { role: 'help', submenu: [{ label: 'Report a Problem…', click: () => this.report() }] },
      ]),
    );
    if (stop.length > 0) app.dock?.setMenu(Menu.buildFromTemplate(stop));
  }

  leave(): void {
    this.state = 'leaving';
  }

  private hidden(): void {
    this.ending();
    for (const window of this.windows()) if (!window.isDestroyed()) window.hide();
  }

  private async quit(): Promise<void> {
    this.hidden();
    if (this.places !== null) {
      const left = await stopIdle(this.surfaceUrl, this.places);
      if (left.stopped && left.refusal !== null) await this.refused(left.refusal);
    }
    this.leave();
    app.quit();
  }

  private async stop(): Promise<void> {
    if (this.state !== 'open') return;
    const work = await machineWork(this.surfaceUrl);
    const shown = this.parent();
    const options = {
      type: 'warning' as const,
      message: `Stop ${CHANNEL.name}?`,
      detail: stopping(work),
      buttons: [`Stop ${CHANNEL.name}`, 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    };
    const answer = shown === undefined ? await dialog.showMessageBox(options) : await dialog.showMessageBox(shown, options);
    if (answer.response !== 0 || this.places === null) return;
    this.state = 'quitting';
    this.hidden();
    const refused = await stopAll(this.places);
    if (refused !== null) await this.refused(refused);
    this.leave();
    app.quit();
  }

  private refused(refusal: Refusal): Promise<void> {
    return tell(
      undefined,
      {
        type: 'error',
        message: `${CHANNEL.name} didn't stop`,
        words: refusal.said ?? `${CHANNEL.name} may still be running. Try again; if it keeps running, report the problem.`,
        details: `${refusal.code}: ${refusal.reason}`,
      },
      this.report,
    );
  }
}
