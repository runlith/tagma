import { expect, test } from 'bun:test';
import { pressureOfLevel, pressureOfPsi } from './hostPressure.js';

test('the macOS pressure level names its three states and nothing else', () => {
  expect(['1\n', '2\n', '4\n', '', '7'].map(pressureOfLevel)).toEqual(['normal', 'warning', 'critical', 'absent', 'absent']);
});

test('Linux PSI is judged by the share of time every task stalled on memory', () => {
  const psi = (full: string) => `some avg10=90.00 avg60=1.00 avg300=0.00 total=1\nfull avg10=${full} avg60=0.00 avg300=0.00 total=1\n`;
  expect([psi('0.00'), psi('12.50'), psi('75.00')].map(pressureOfPsi)).toEqual(['normal', 'warning', 'critical']);
  expect(pressureOfPsi('some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n')).toBe('absent');
});
