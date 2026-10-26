import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const examplesRoot = resolve(packageRoot, '..', 'examples');

test.skip(process.platform !== 'darwin', 'macOS native smoke only');

test('native no-focus-steal reveal keeps Finder frontmost on macOS', async () => {
  const app = await electron.launch({
    args: [resolve(examplesRoot, 'electron-minimal/main.mjs')],
    cwd: resolve(packageRoot, '..'),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Minimal headless capability example' })).toBeVisible();

    const meta = await page.evaluate(async () => {
      return window.windowBehaviorExample.getMeta();
    });

    expect(meta.noFocusStealSupport.status).toBe('enabled');

    await page.getByRole('button', { name: 'Toggle focus policy' }).click();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          return window.windowBehaviorExample.getState();
        }),
      )
      .toMatchObject({
        focusPolicy: 'no-focus-steal',
      });

    await page.evaluate(async () => {
      await window.windowBehaviorExample.hideWindow();
    });

    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(false);

    activateApp('Finder');
    await expect.poll(getFrontmostProcessName).toBe('Finder');

    await page.evaluate(async () => {
      await window.windowBehaviorExample.revealWindow();
    });

    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true);
    await expect.poll(getFrontmostProcessName).toBe('Finder');
  } finally {
    await app.close();
  }
});

test('overlay pass-through allows a real click to reach Finder behind the window', async () => {
  test.skip(!hasAccessibilityPermission(), 'macOS Accessibility permission is required for synthetic click injection.');

  arrangeFinderWindow();

  const app = await electron.launch({
    args: [resolve(examplesRoot, 'electron-overlay-playground/main.mjs')],
    cwd: resolve(packageRoot, '..'),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByText('Overlay playground')).toBeVisible();

    await page.getByRole('button', { name: 'Click-through' }).click();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          return window.windowBehaviorOverlayExample.getState();
        }),
      )
      .toMatchObject({
        passThrough: true,
      });

    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) {
        throw new Error('No BrowserWindow instance is available.');
      }

      return window.getBounds();
    });

    const clickPoint = {
      x: bounds.x + Math.round(bounds.width / 2),
      y: bounds.y + 140,
    };

    activateApp('Finder');
    await expect.poll(getFrontmostProcessName).toBe('Finder');

    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) {
        throw new Error('No BrowserWindow instance is available.');
      }

      window.show();
      window.focus();
      window.moveTop();
    });

    clickScreenPoint(clickPoint);
    await expect.poll(getFrontmostProcessName).toBe('Finder');
  } finally {
    await app.close();
  }
});

function activateApp(name) {
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

function clickScreenPoint(point) {
  const scriptPath = createSwiftClickScript();
  const result = execFileSync('swift', [scriptPath, String(point.x), String(point.y)], {
    encoding: 'utf8',
  }).trim();

  if (result !== 'ok') {
    throw new Error(`macOS click injection failed: ${result}`);
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

function execAppleScript(script) {
  return execFileSync('osascript', ['-e', script], {
    encoding: 'utf8',
  }).trim();
}
