#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8787';
const DEFAULT_WRANGLER_CONFIG = 'wrangler.template.toml';
const DEFAULT_WRANGLER_ENV = 'development';
const API_BASE_URL = process.env.API_BASE_URL || DEFAULT_API_BASE_URL;
const HEALTH_PATH = process.env.API_TEST_HEALTH_PATH || '/health';
const SHOULD_AUTOSTART = parseBoolean(process.env.API_TEST_AUTOSTART, true);
const WRANGLER_CONFIG = process.env.API_TEST_WRANGLER_CONFIG || DEFAULT_WRANGLER_CONFIG;
const WRANGLER_ENV = process.env.API_TEST_WRANGLER_ENV || DEFAULT_WRANGLER_ENV;
const STARTUP_TIMEOUT_MS = parsePositiveInteger(
  process.env.API_TEST_STARTUP_TIMEOUT_MS,
  45000,
  1000,
);
const POLL_INTERVAL_MS = parsePositiveInteger(process.env.API_TEST_POLL_INTERVAL_MS, 500, 50);
const REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.API_TEST_REQUEST_TIMEOUT_MS,
  1500,
  100,
);

function parseBoolean(value, fallback) {
  if (typeof value === 'undefined') return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;

  return fallback;
}

function parsePositiveInteger(value, fallback, minimum = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;

  return Math.max(minimum, Math.floor(numericValue));
}

function ensureTrailingSlash(urlText) {
  return urlText.endsWith('/') ? urlText : `${urlText}/`;
}

function buildHealthUrl(baseUrl) {
  return new URL(HEALTH_PATH, ensureTrailingSlash(baseUrl)).toString();
}

function parsePort(baseUrl) {
  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.port) {
    const explicitPort = Number(parsedUrl.port);
    if (!Number.isInteger(explicitPort) || explicitPort < 1) {
      throw new Error(`Invalid API_BASE_URL port: ${parsedUrl.port}`);
    }
    return explicitPort;
  }

  return parsedUrl.protocol === 'https:' ? 443 : 80;
}

async function canReachServer(baseUrl) {
  const healthUrl = buildHealthUrl(baseUrl);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: abortController.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function waitForProcessExit(childProcess) {
  return new Promise((resolve, reject) => {
    childProcess.once('error', reject);
    childProcess.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function waitForServerReady(baseUrl, devProcess) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await canReachServer(baseUrl)) return;

    if (devProcess.exitCode !== null) {
      throw new Error(`Wrangler dev exited before tests started (exit code: ${devProcess.exitCode})`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out after ${STARTUP_TIMEOUT_MS}ms waiting for API server at ${buildHealthUrl(baseUrl)}`,
  );
}

function startWranglerDev(baseUrl) {
  const port = parsePort(baseUrl);

  return spawn(
    'wrangler',
    [
      'dev',
      '--env',
      WRANGLER_ENV,
      '--config',
      WRANGLER_CONFIG,
      '--port',
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: 'inherit',
    },
  );
}

function startNodeTests(baseUrl) {
  return spawn(process.execPath, ['--test', 'test/api-smoke.test.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_BASE_URL: baseUrl,
    },
    stdio: 'inherit',
  });
}

function waitForExitOrTimeout(childProcess, timeoutMs) {
  if (childProcess.exitCode !== null) return Promise.resolve(true);

  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = () => {
      clearTimeout(timer);
      childProcess.off('exit', onExit);
    };

    const onExit = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(true);
    };

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(false);
    }, timeoutMs);

    childProcess.once('exit', onExit);
  });
}

async function stopProcessGracefully(childProcess) {
  if (!childProcess || childProcess.exitCode !== null) return;

  childProcess.kill('SIGINT');
  if (await waitForExitOrTimeout(childProcess, 5000)) return;

  childProcess.kill('SIGTERM');
  if (await waitForExitOrTimeout(childProcess, 3000)) return;

  childProcess.kill('SIGKILL');
  await waitForExitOrTimeout(childProcess, 2000);
}

let ownedDevProcess = null;

try {
  const hasRunningServer = await canReachServer(API_BASE_URL);
  if (hasRunningServer) {
    console.log(`[test:api] Reusing running server at ${API_BASE_URL}`);
  } else if (SHOULD_AUTOSTART) {
    console.log(`[test:api] No server detected at ${API_BASE_URL}. Starting wrangler dev...`);
    ownedDevProcess = startWranglerDev(API_BASE_URL);
    await waitForServerReady(API_BASE_URL, ownedDevProcess);
    console.log(`[test:api] Worker is ready at ${API_BASE_URL}`);
  } else {
    throw new Error(
      `Cannot reach API at ${API_BASE_URL} and API_TEST_AUTOSTART is disabled. Start server manually or enable API_TEST_AUTOSTART.`,
    );
  }

  const testProcess = startNodeTests(API_BASE_URL);
  const { code, signal } = await waitForProcessExit(testProcess);

  if (signal) {
    process.exitCode = 1;
    console.error(`[test:api] Test process terminated by signal: ${signal}`);
  } else {
    process.exitCode = code ?? 1;
  }
} catch (error) {
  process.exitCode = 1;
  console.error(`[test:api] ${error.message}`);
} finally {
  if (ownedDevProcess) {
    console.log('[test:api] Stopping auto-started wrangler dev...');
    await stopProcessGracefully(ownedDevProcess);
  }
}
