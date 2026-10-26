export function openBrowserDefault(url: string): void {
  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    Bun.spawn([command, ...args], { stdout: 'ignore', stderr: 'ignore' });
  } catch (error) {
    console.warn('[oauth] failed to launch system browser:', error);
  }
}
