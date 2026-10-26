import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const extensions = new Set(['.svelte', '.css', '.html', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const forbidden = /prefers-reduced-motion|\bmotion-(?:reduce|safe):|\b(?:useReducedMotion|reducedMotion|prefersReducedMotion)\b/gi;
// Each bench page is a captured record of what one harness produced, and the rule this check
// carries covers maintained source alone — editing the record would falsify what it recorded.
const captured = /^bench\/[^/]+\/index\.html$/;
const paths = new Set(
  execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'apps', 'packages', 'bench', 'scripts'], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean),
);
const findings = [];
for (const path of [...paths].sort()) {
  if (path === 'scripts/checkMotion.mjs' || captured.test(path) || !extensions.has(extname(path))) continue;
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  for (const [index, line] of source.split('\n').entries()) {
    forbidden.lastIndex = 0;
    if (forbidden.test(line)) findings.push(`${path}:${index + 1}: ${line.trim()}`);
  }
}
if (findings.length > 0) {
  console.error('Motion preferences are forbidden in Runlith UI source. Keep the intended animation unconditional.');
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Motion policy: no preference-gated animation in owned source.');
}
