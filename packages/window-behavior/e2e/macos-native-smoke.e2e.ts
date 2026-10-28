import { expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { e2e } from '@runlith/e2e/browser';
import { Effect, Schedule } from 'effect';
import { example } from './examples.fixture.ts';

const finderFrontmost = Effect.sync(getFrontmostProcessName).pipe(
  Effect.repeat({ until: (name) => name === 'Finder', schedule: Schedule.spaced('100 millis') }),
);

e2e.effect(
  'native no-focus-steal reveal keeps Finder frontmost on macOS',
  ({ page, electron }) =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        requireMacOS();
        await page.getByRole('heading', { name: 'Minimal headless capability example' }).waitFor({ state: 'visible' });
        const meta = await page.evaluate(() => window.windowBehaviorExample.getMeta());
        expect(meta.noFocusStealSupport.status).toBe('enabled');

        await page.getByRole('button', { name: 'Toggle focus policy' }).click();
        await page.waitForFunction(async () => (await window.windowBehaviorExample.getState()).focusPolicy === 'no-focus-steal');
        await page.evaluate(() => window.windowBehaviorExample.hideWindow());
        expect(await electron!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(false);
        activateApp('Finder');
      });
      yield* finderFrontmost;
      yield* Effect.promise(async () => {
        await page.evaluate(() => window.windowBehaviorExample.revealWindow());
        expect(await electron!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true);
      });
      yield* finderFrontmost;
    }),
  example('electron-minimal'),
);

e2e.effect(
  'overlay pass-through allows a real click to reach Finder behind the window',
  ({ page, electron }) =>
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        requireMacOS();
        if (!hasAccessibilityPermission()) throw new Error('macOS Accessibility permission is required for synthetic click injection.');
        arrangeFinderWindow();
      });
      const clickPoint = yield* Effect.promise(async () => {
        await page.getByText('Overlay playground').waitFor({ state: 'visible' });
        await page.getByRole('button', { name: 'Click-through' }).click();
        await page.waitForFunction(async () => (await window.windowBehaviorOverlayExample.getState()).passThrough === true);
        const bounds = await electron!.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          if (!window) throw new Error('No BrowserWindow instance is available.');
          return window.getBounds();
        });
        activateApp('Finder');
        return { x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + 140 };
      });
      yield* finderFrontmost;
      yield* Effect.promise(async () => {
        await electron!.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          if (!window) throw new Error('No BrowserWindow instance is available.');
          window.show();
          window.focus();
          window.moveTop();
        });
        clickScreenPoint(clickPoint);
      });
      yield* finderFrontmost;
    }),
  example('electron-overlay-playground'),
);

function requireMacOS() {
  if (process.platform !== 'darwin') throw new Error('macOS native smoke requires macOS.');
}

function activateApp(name: string) {
  execAppleScript(`tell application "${name}" to activate`);
}

function arrangeFinderWindow() {
  execAppleScript(`
    tell application "Finder"
      activate
      reopen
      set bounds of front window to {120, 120, 1500, 980}
    end tell
  `);
}

function getFrontmostProcessName() {
  return execAppleScript('tell application "System Events" to get name of first process whose frontmost is true');
}

function clickScreenPoint(point: { x: number; y: number }) {
  const scriptPath = createSwiftClickScript();
  try {
    const result = execFileSync('swift', [scriptPath, String(point.x), String(point.y)], { encoding: 'utf8' }).trim();
    if (result !== 'ok') throw new Error(`macOS click injection failed: ${result}`);
  } finally {
    rmSync(dirname(scriptPath), { recursive: true, force: true });
  }
}

function createSwiftClickScript() {
  const dir = mkdtempSync(join(tmpdir(), 'window-behavior-click-'));
  const scriptPath = join(dir, 'click.swift');

  writeFileSync(
    scriptPath,
    `
import Cocoa
import ApplicationServices

let x = Double(CommandLine.arguments[1])!
let y = Double(CommandLine.arguments[2])!
let point = CGPoint(x: x, y: y)

guard let source = CGEventSource(stateID: .hidSystemState) else {
  print("missing-event-source")
  exit(1)
}

guard AXIsProcessTrusted() else {
  print("accessibility-not-trusted")
  exit(1)
}

let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)

move?.post(tap: .cghidEventTap)
usleep(120000)
down?.post(tap: .cghidEventTap)
usleep(50000)
up?.post(tap: .cghidEventTap)
print("ok")
`,
    'utf8',
  );

  return scriptPath;
}

function hasAccessibilityPermission() {
  return (
    execFileSync('swift', ['-e', 'import ApplicationServices\nprint(AXIsProcessTrusted() ? "true" : "false")'], {
      encoding: 'utf8',
    }).trim() === 'true'
  );
}

function execAppleScript(script: string) {
  return execFileSync('osascript', ['-e', script], {
    encoding: 'utf8',
  }).trim();
}
