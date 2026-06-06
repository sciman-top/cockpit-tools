#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const argv = new Set(process.argv.slice(2));

function hasFlag(name) {
  return argv.has(name);
}

function logTitle(title) {
  console.log(`\n=== ${title} ===`);
}

function resolveCommand(command) {
  if (command === 'node') {
    return { command: process.execPath, argsPrefix: [] };
  }

  if (command === 'npm' && process.env.npm_execpath) {
    return { command: process.execPath, argsPrefix: [process.env.npm_execpath] };
  }

  if (command === 'npm' && process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      argsPrefix: ['/d', '/s', '/c', 'npm'],
    };
  }

  if (process.platform !== 'win32') {
    return { command, argsPrefix: [] };
  }

  const commandMap = new Map([
    ['cargo', 'cargo.exe'],
    ['go', 'go.exe'],
    ['pwsh', 'pwsh.exe'],
  ]);
  return { command: commandMap.get(command) || command, argsPrefix: [] };
}

function runStep(step) {
  const cmd = step.command;
  const resolved = resolveCommand(cmd);
  const executable = resolved.command;
  const args = [...resolved.argsPrefix, ...step.args];
  const displayArgs = step.args;
  const cwd = step.cwd || process.cwd();

  logTitle(step.name);
  console.log(`$ ${cmd} ${displayArgs.join(' ')}`);
  console.log(`cwd: ${cwd}`);

  const result = spawnSync(executable, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  if (typeof result.status === 'number' && result.status !== 0) {
    return {
      ok: false,
      message: `Step failed: ${step.name} (exit=${result.status})`,
    };
  }

  if (result.error) {
    return {
      ok: false,
      message: `Step failed: ${step.name} (${result.error.message})`,
    };
  }

  return { ok: true };
}

const steps = [];

if (!hasFlag('--skip-merge-conflict-check')) {
  steps.push({
    name: 'Merge conflict marker check',
    command: 'pwsh',
    args: [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'scripts/check-merge-conflict-markers.ps1',
    ],
  });
}

if (!hasFlag('--skip-locales')) {
  steps.push({
    name: 'Locale completeness check',
    command: 'node',
    args: ['scripts/check_locales.cjs'],
  });
}

if (!hasFlag('--skip-local-hardened-api-guards')) {
  steps.push({
    name: 'Local hardened API live-risk guard',
    command: 'pwsh',
    args: [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'scripts/test-local-hardened-api-live-risk-guard.ps1',
    ],
  });
}

if (!hasFlag('--skip-refresh-risk-guard')) {
  steps.push({
    name: 'Refresh-risk guard',
    command: 'node',
    args: ['scripts/test-refresh-risk-guard.cjs'],
  });
}

if (!hasFlag('--skip-codex-api-service-continuity')) {
  steps.push({
    name: 'Codex API service continuity focus',
    command: 'pwsh',
    args: [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'scripts/test-codex-api-service-continuity-focus.ps1',
    ],
  });
}

if (!hasFlag('--skip-typecheck')) {
  steps.push({
    name: 'TypeScript typecheck',
    command: 'npm',
    args: ['run', 'typecheck'],
  });
}

if (!hasFlag('--skip-build')) {
  steps.push({
    name: 'Web build',
    command: 'npm',
    args: ['run', 'build'],
  });
}

if (!hasFlag('--skip-cargo')) {
  steps.push({
    name: 'Rust cargo check',
    command: 'cargo',
    args: ['check'],
    cwd: path.join(process.cwd(), 'src-tauri'),
  });
}

if (!hasFlag('--skip-cargo-test')) {
  steps.push({
    name: 'Sidecar Go tests',
    command: 'go',
    args: ['test', './...'],
    cwd: path.join(process.cwd(), 'sidecars', 'cockpit-cliproxy'),
  });

  steps.push({
    name: 'Rust cargo test (cockpit-core lib)',
    command: 'cargo',
    args: ['test', '-p', 'cockpit-core', '--lib'],
  });

  steps.push({
    name: 'Rust targeted clippy hygiene',
    command: 'cargo',
    args: [
      'clippy',
      '--lib',
      '--tests',
      '--',
      '-A',
      'warnings',
      '-D',
      'clippy::await_holding_lock',
      '-D',
      'clippy::derivable_impls',
      '-D',
      'clippy::field_reassign_with_default',
      '-D',
      'clippy::manual_pattern_char_comparison',
      '-D',
      'clippy::cloned_ref_to_slice_refs',
      '-D',
      'clippy::map_identity',
      '-D',
      'clippy::unnecessary_cast',
      '-D',
      'clippy::unwrap_or_default',
      '-D',
      'clippy::redundant_closure',
    ],
    cwd: path.join(process.cwd(), 'src-tauri'),
  });

  steps.push({
    name: 'Rust cargo test (lib)',
    command: 'cargo',
    args: ['test', '--lib'],
    cwd: path.join(process.cwd(), 'src-tauri'),
  });
}

if (steps.length === 0) {
  console.log('No steps enabled. Use without --skip-* flags to run checks.');
  process.exit(0);
}

console.log('Cockpit Tools release preflight started.');
console.log(
  'Enabled steps:',
  steps.map((item) => item.name).join(' | ')
);

for (const step of steps) {
  const result = runStep(step);
  if (!result.ok) {
    console.error(`\n[FAILED] ${result.message}`);
    process.exit(1);
  }
}

console.log('\n[OK] Release preflight completed.');
