import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

export type HostPressure = 'normal' | 'warning' | 'critical' | 'absent';

const SYSCTL = '/usr/sbin/sysctl';
const PSI = '/proc/pressure/memory';
const PSI_CRITICAL_FULL_PERCENT = 60;
const PSI_WARNING_FULL_PERCENT = 10;

export async function readHostPressure(): Promise<HostPressure> {
  if (process.platform === 'darwin' && existsSync(SYSCTL)) {
    const read = Bun.spawn([SYSCTL, '-n', 'kern.memorystatus_vm_pressure_level'], { stdout: 'pipe', stderr: 'ignore' });
    const [text, exit] = await Promise.all([new Response(read.stdout).text(), read.exited]);
    return exit === 0 ? pressureOfLevel(text) : 'absent';
  }
  if (process.platform === 'linux' && existsSync(PSI)) return pressureOfPsi(await readFile(PSI, 'utf8'));
  return 'absent';
}

export function pressureOfLevel(text: string): HostPressure {
  switch (text.trim()) {
    case '1':
      return 'normal';
    case '2':
      return 'warning';
    case '4':
      return 'critical';
    default:
      return 'absent';
  }
}

export function pressureOfPsi(text: string): HostPressure {
  const full = /^full avg10=([\d.]+)/m.exec(text)?.[1];
  if (full === undefined) return 'absent';
  const percent = Number(full);
  if (!Number.isFinite(percent)) return 'absent';
  return percent >= PSI_CRITICAL_FULL_PERCENT ? 'critical' : percent >= PSI_WARNING_FULL_PERCENT ? 'warning' : 'normal';
}
