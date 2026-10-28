import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import globalSetup from './global-setup';

// External-server mode exposes the same cleanup closure without starting a
// Shelley server. The terminals still use the actual embedded exe-scroll.
process.env.TEST_SERVER_URL = 'http://example.invalid';

async function checkGitIsolation() {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'shelley-git-config-'));
  const hooksDir = join(fixtureDir, 'hooks');
  const globalConfig = join(fixtureDir, 'gitconfig');
  const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
  const previousGitDir = process.env.GIT_DIR;
  const previousNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  mkdirSync(hooksDir);
  writeFileSync(join(hooksDir, 'commit-msg'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  writeFileSync(globalConfig, `[core]\n\thooksPath = ${hooksDir}\n`);
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  process.env.GIT_DIR = join(fixtureDir, 'wrong-repo');

  const cleanup = await globalSetup();
  const cwd = process.env.SHELLEY_TEST_CWD!;
  try {
    assert.equal(process.env.GIT_CONFIG_GLOBAL, '/dev/null');
    assert.equal(process.env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(process.env.GIT_DIR, undefined);
    execFileSync('git', ['-C', cwd, 'init', '--quiet']);
    execFileSync('git', [
      '-C', cwd,
      '-c', 'user.name=Shelley Test',
      '-c', 'user.email=test@example.com',
      'commit', '--quiet', '--allow-empty', '-m', 'Hook-independent fixture',
    ]);
  } finally {
    await cleanup();
    assert.equal(process.env.GIT_CONFIG_GLOBAL, globalConfig);
    assert.equal(process.env.GIT_CONFIG_NOSYSTEM, previousNoSystem);
    assert.equal(process.env.GIT_DIR, join(fixtureDir, 'wrong-repo'));
    if (previousGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
    if (previousNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = previousNoSystem;
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

async function checkFailedSetupRestoresEnvironment() {
  const fakeBin = mkdtempSync(join(tmpdir(), 'shelley-failing-git-'));
  const originalPath = process.env.PATH!;
  const testServerURL = process.env.TEST_SERVER_URL;
  const globalConfig = process.env.GIT_CONFIG_GLOBAL;
  writeFileSync(join(fakeBin, 'git'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  process.env.PATH = `${fakeBin}:${originalPath}`;
  delete process.env.TEST_SERVER_URL;
  try {
    await assert.rejects(globalSetup());
    assert.equal(process.env.GIT_CONFIG_GLOBAL, globalConfig);
    assert.equal(process.env.SHELLEY_TEST_CWD, undefined);
  } finally {
    process.env.PATH = originalPath;
    if (testServerURL === undefined) delete process.env.TEST_SERVER_URL;
    else process.env.TEST_SERVER_URL = testServerURL;
    rmSync(fakeBin, { recursive: true, force: true });
  }
}

// Darwin's ps sess column is a hexadecimal pointer, not a numeric PID.
// Feed a captured-format snapshot through the real cleanup without signaling.
async function checkDarwinSessionFormat() {
  const cleanup = await globalSetup();
  const fakeBin = mkdtempSync(join(tmpdir(), 'shelley-fake-ps-'));
  const originalPath = process.env.PATH!;
  const originalKill = process.kill;
  const dir = dirname(process.env.SHELLEY_TEST_CWD!);
  const killed: number[] = [];
  const rows = [
    `8101 1 8101 deadbeef exe-scroll: session ${dir}/terminals/owned.sock`,
    '8102 8101 8102 cafe0123 sh -c bash',
    '8103 8102 8103 cafe0123 sleep 120',
    '8104 1 8104 baddcafe sleep 120',
    '8105 1 8105 baddcafe exe-scroll: session /tmp/unrelated/terminals/x.sock',
    // Busy CI hosts can produce more than execFileSync's default 1 MiB buffer.
    ...Array(1500).fill(`8106 1 8106 baddcafe unrelated ${'x'.repeat(800)}`),
  ].join('\n');
  assert.ok(Buffer.byteLength(rows) > 1024 * 1024);
  try {
    writeFileSync(join(fakeBin, 'ps'), `#!/bin/sh\ncat <<'PS'\n${rows}\nPS\n`, { mode: 0o755 });
    process.env.PATH = `${fakeBin}:${originalPath}`;
    process.kill = ((pid: number) => { killed.push(pid); return true; }) as typeof process.kill;
    await cleanup();
    assert.deepEqual(killed, [-8102, -8103, 8101]);
  } finally {
    process.kill = originalKill;
    process.env.PATH = originalPath;
    rmSync(fakeBin, { recursive: true, force: true });
    await cleanup();
  }
}

await checkGitIsolation();
await checkFailedSetupRestoresEnvironment();
await checkDarwinSessionFormat();
const cleanup = await globalSetup();
const groups = new Set<number>();
const servers = new Set<number>();
let unrelated: number | undefined;

function alive(pid: number) {
  try {
    const state = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return state !== '' && !state.startsWith('Z');
  } catch {
    return false;
  }
}

async function expectStopped(pid: number) {
  const deadline = Date.now() + 3000;
  while (alive(pid) && Date.now() < deadline) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(alive(pid), false, `process ${pid} survived terminal cleanup`);
}

try {
  const dir = dirname(process.env.SHELLEY_TEST_CWD!);
  const fixture = spawnSync('python3', [join(dirname(fileURLToPath(import.meta.url)), 'global-setup.test.py'), dir], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (fixture.error) throw fixture.error;
  assert.equal(fixture.status, 0, fixture.stderr || fixture.error?.message);
  const sessions = JSON.parse(fixture.stdout);
  for (const name of ['idle', 'background', 'foreground'] as const) {
    const session = sessions[name] as { server: number; leader: number; shell: number; job: number | null; job_group: number | null };
    servers.add(session.server);
    groups.add(session.leader);
    if (session.job_group !== null) groups.add(session.job_group);
    assert.equal(alive(session.server), true, `${name} server missing before cleanup`);
    assert.equal(alive(session.shell), true, `${name} shell missing before cleanup`);
    if (session.job !== null) {
      assert.notEqual(session.job_group, session.leader, `${name} job is not in a separate process group`);
      assert.equal(alive(session.job), true, `${name} job missing before cleanup`);
    }
  }
  unrelated = sessions.unrelated;
  assert.equal(alive(unrelated!), true, 'unrelated session missing before cleanup');

  await cleanup();
  for (const name of ['idle', 'background', 'foreground'] as const) {
    const session = sessions[name];
    await expectStopped(session.server);
    await expectStopped(session.shell);
    if (session.job !== null) await expectStopped(session.job);
  }
  assert.equal(alive(unrelated!), true, 'unrelated session was killed');
  console.log('real exe-scroll PTY teardown: idle, foreground, background; unrelated session spared');
} finally {
  for (const group of groups) {
    try { process.kill(-group, 'SIGKILL'); } catch { /* already stopped */ }
  }
  for (const server of servers) {
    try { process.kill(server, 'SIGKILL'); } catch { /* already stopped */ }
  }
  if (unrelated) {
    try { process.kill(unrelated, 'SIGKILL'); } catch { /* already stopped */ }
  }
  await cleanup();
  delete process.env.TEST_SERVER_URL;
}
