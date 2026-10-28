import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';

test('terminal teardown stops owned jobs and spares unrelated sessions', () => {
  execFileSync('node_modules/.bin/tsx', ['scripts/global-setup.test.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'inherit',
    timeout: 30_000,
  });
});
