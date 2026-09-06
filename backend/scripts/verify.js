const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

function run(label, command, args, cwd) {
  const started = performance.now();
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  return { label, ok: result.status === 0, durationSeconds: Number(((performance.now() - started) / 1000).toFixed(2)), status: result.status };
}

const backend = path.resolve(__dirname, '..');
const steps = [
  run('backend-tests', 'npm', ['test'], backend),
  run('frontend-build', 'npm', ['run', 'build'], path.resolve(backend, '../frontend')),
];
const report = { generatedAt: new Date().toISOString(), steps, totalSeconds: Number(steps.reduce((sum, step) => sum + step.durationSeconds, 0).toFixed(2)), deliveryUnder10Minutes: steps.every((step) => step.ok) && steps.reduce((sum, step) => sum + step.durationSeconds, 0) < 600 };
const reportDir = path.resolve(backend, 'tests/reports'); fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'verification-latest.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (steps.some((step) => !step.ok)) process.exitCode = 1;
