#!/usr/bin/env node
// Runs the API server (with in-process worker) and the Vite dev server together.
const { spawn } = require('node:child_process');

const procs = [
  ['server', ['run', 'dev', '-w', 'server']],
  ['client', ['run', 'dev', '-w', 'client']],
].map(([name, args]) => {
  const p = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: 'inherit' });
  p.on('exit', (code) => {
    console.log(`[dev] ${name} exited with code ${code}`);
    procs.forEach((other) => other !== p && other.kill('SIGTERM'));
    process.exit(code ?? 0);
  });
  return p;
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => procs.forEach((p) => p.kill(sig)));
}
