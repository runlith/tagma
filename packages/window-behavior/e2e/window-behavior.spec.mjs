import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const examplesRoot = resolve(packageRoot, '..', 'examples');

test('minimal example applies always-on-top and capture protection to the BrowserWindow', async () => {
  const app = await launchExample('electron-minimal/main.mjs');

  try {
    const page = await app.firstWindow();
    await waitForMinimalExample(page);

    await page.getByRole('button', { name: 'Toggle always on top' }).click();
    await expect.poll(() => readMinimalState(page).then((state) => state.alwaysOnTop)).toBe(true);
    await expect.poll(() => readMainWindowEffects(app).then((effects) => effects.alwaysOnTop)).toBe(true);

    await page.getByRole('button', { name: 'Toggle capture protection' }).click();
    await expect.poll(() => readMinimalState(page).then((state) => state.captureProtection)).toBe(true);
    await expect.poll(() => readMainWindowEffects(app).then((effects) => effects.contentProtection)).toBe(true);
  } finally {
    await app.close();
  }
});

test('minimal example applies transparent opacity changes to the BrowserWindow', async () => {
  const app = await launchExample('electron-minimal/main.mjs');

  try {
    const page = await app.firstWindow();
    await waitForMinimalExample(page);

    await page.getByRole('button', { name: 'Toggle transparent mode' }).click();
    await expect.poll(() => readMinimalState(page).then((state) => state.transparent)).toBe(true);

    await setRangeValue(page, '#window-opacity', 40);
    await expect.poll(() => readMinimalState(page).then((state) => state.windowOpacity)).toBeCloseTo(0.4, 5);
    await expect.poll(() => readMainWindowEffects(app).then((effects) => effects.opacity)).toBeCloseTo(0.4, 5);
  } finally {
    await app.close();
  }
});

test('minimal example applies no-focus-steal with the expected host mode', async () => {
  const app = await launchExample('electron-minimal/main.mjs');

  try {
    const page = await app.firstWindow();
    await waitForMinimalExample(page);

    await page.getByRole('button', { name: 'Toggle focus policy' }).click();
    await expect.poll(() => readMinimalState(page).then((state) => state.focusPolicy)).toBe('no-focus-steal');

    const meta = await readMinimalMeta(page);
    await expect(page.locator('#focus-input')).toBeEditable();
    await page.locator('#focus-input').click();
    await expect(page.locator('#focus-input')).toBeFocused();

    if (meta.noFocusStealSupport.status === 'disabled') {
      const hostMode = await readNoFocusStealHostMode(app);
      expect(hostMode.focusListeners).toBeGreaterThan(0);
      expect(hostMode.blurListeners).toBeGreaterThan(0);
    }
  } finally {
    await app.close();
  }
});

test('overlay example applies overlay and pass-through state changes', async () => {
  const app = await launchExample('electron-overlay-playground/main.mjs');

  try {
    const page = await app.firstWindow();
    await waitForOverlayExample(page);

    await page.getByRole('button', { name: 'Background' }).click();
    await expect.poll(() => readOverlayState(page).then((state) => state.overlayBackgroundVisible)).toBe(false);
    await expect(page.locator('#root')).toHaveClass(/background-hidden/);

    await setRangeValue(page, '#background-opacity', 45);
    await expect.poll(() => readOverlayState(page).then((state) => state.overlayBackgroundOpacity)).toBeCloseTo(0.45, 5);

    await page.getByRole('button', { name: 'Click-through' }).click();
    await expect.poll(() => readOverlayState(page).then((state) => state.passThrough)).toBe(true);
  } finally {
    await app.close();
  }
});

async function launchExample(relativeEntryPath) {
  return electron.launch({
    args: [resolve(examplesRoot, relativeEntryPath)],
    cwd: resolve(packageRoot, '..'),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });
}

async function waitForMinimalExample(page) {
  await expect(page.getByRole('heading', { name: 'Minimal headless capability example' })).toBeVisible();
  await expect(page.locator('#state')).toContainText('"alwaysOnTop"');
}

async function waitForOverlayExample(page) {
  await expect(page.getByText('Overlay playground')).toBeVisible();
  await expect.poll(() => readOverlayState(page).then((state) => state.alwaysOnTop)).toBe(true);
}

async function readMinimalState(page) {
  const stateText = await page.locator('#state').textContent();

  if (!stateText) {
    throw new Error('Minimal example state is empty.');
  }

  return JSON.parse(stateText);
}

async function readMinimalMeta(page) {
  return page.evaluate(async () => {
    return window.windowBehaviorExample.getMeta();
  });
}

async function readOverlayState(page) {
  return page.evaluate(async () => {
    return window.windowBehaviorOverlayExample.getState();
  });
}

async function readMainWindowEffects(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) {
      throw new Error('No BrowserWindow instance is available.');
    }

    return {
      alwaysOnTop: window.isAlwaysOnTop(),
      opacity: window.getOpacity(),
      contentProtection: typeof window.isContentProtected === 'function' ? window.isContentProtected() : false,
    };
  });
}

async function readNoFocusStealHostMode(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) {
      throw new Error('No BrowserWindow instance is available.');
    }

    return {
      focusListeners: window.listenerCount('focus'),
      blurListeners: window.listenerCount('blur'),
    };
  });
}

async function setRangeValue(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error('Expected a range input.');
    }

    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
