#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8787';
const DEFAULT_WRANGLER_CONFIG = 'wrangler.template.toml';
const DEFAULT_WRANGLER_ENV = 'development';
const API_BASE_URL = process.env.API_BASE_URL || DEFAULT_API_BASE_URL;
const HEALTH_PATH = process.env.LOAD_TEST_HEALTH_PATH || '/health';
const SHOULD_AUTOSTART = parseBoolean(process.env.LOAD_TEST_AUTOSTART, true);
const WRANGLER_CONFIG = process.env.LOAD_TEST_WRANGLER_CONFIG || DEFAULT_WRANGLER_CONFIG;
const WRANGLER_ENV = process.env.LOAD_TEST_WRANGLER_ENV || DEFAULT_WRANGLER_ENV;
const STARTUP_TIMEOUT_MS = parsePositiveInteger(
  process.env.LOAD_TEST_STARTUP_TIMEOUT_MS,
  45000,
  1000,
);
const POLL_INTERVAL_MS = parsePositiveInteger(process.env.LOAD_TEST_POLL_INTERVAL_MS, 400, 50);
const REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.LOAD_TEST_REQUEST_TIMEOUT_MS,
  15000,
  500,
);

const TOTAL_REQUESTS = parsePositiveInteger(process.env.LOAD_TEST_TOTAL_REQUESTS, 80, 1);
const CONCURRENCY = parsePositiveInteger(process.env.LOAD_TEST_CONCURRENCY, 16, 1);
const USE_DISTINCT_IPS = parseBoolean(process.env.LOAD_TEST_DISTINCT_IPS, true);
const REQUIRE_FULL_SUCCESS = parseBoolean(process.env.LOAD_TEST_REQUIRE_FULL_SUCCESS, true);
const SHOULD_CLEANUP = parseBoolean(process.env.LOAD_TEST_CLEANUP, true);

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

function buildApiUrl(baseUrl, pathname) {
  return new URL(pathname, ensureTrailingSlash(baseUrl)).toString();
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

async function fetchWithTimeout(url, options = {}) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function canReachServer(baseUrl) {
  try {
    const response = await fetchWithTimeout(buildHealthUrl(baseUrl), { method: 'GET' });
    return response.ok;
  } catch {
    return false;
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
      throw new Error(`Wrangler dev exited before load test started (exit code: ${devProcess.exitCode})`);
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

function buildDistinctClientIp(index) {
  const second = Math.floor(index / 65025) % 255;
  const third = Math.floor(index / 255) % 255;
  const fourth = (index % 255) + 1;
  return `10.${second}.${third}.${fourth}`;
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function workerLoop() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) break;

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));
  return results;
}

function collectStatusCounts(results) {
  const counts = new Map();

  for (const result of results) {
    const key = String(result.status);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Object.fromEntries([...counts.entries()].sort((left, right) => Number(left[0]) - Number(right[0])));
}

async function createToyBurst(baseUrl) {
  const burstPrefix = `LoadBurst-${Date.now()}`;
  const createUrl = buildApiUrl(baseUrl, '/api/toys');
  const requestIndices = Array.from({ length: TOTAL_REQUESTS }, (_, index) => index);

  const createResults = await runWithConcurrency(requestIndices, CONCURRENCY, async (index) => {
    const headers = {
      'content-type': 'application/json',
    };

    if (USE_DISTINCT_IPS) {
      headers['x-forwarded-for'] = buildDistinctClientIp(index + 1);
    }

    const body = JSON.stringify({
      name: `${burstPrefix}-${index}`,
      image: `https://example.com/load-${index}.png`,
      likes: index % 10,
    });

    try {
      const response = await fetchWithTimeout(createUrl, {
        method: 'POST',
        headers,
        body,
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      return {
        index,
        status: response.status,
        toyId: Number(payload?.id),
        payload,
      };
    } catch (error) {
      return {
        index,
        status: 0,
        error: String(error?.message || error),
      };
    }
  });

  const successResults = createResults.filter((result) => result.status === 201 && Number.isSafeInteger(result.toyId));
  const createdIds = successResults.map((result) => result.toyId);
  const uniqueCreatedIds = new Set(createdIds);

  const listResponse = await fetchWithTimeout(buildApiUrl(baseUrl, '/api/toys'), { method: 'GET' });
  const listedToys = await listResponse.json();
  const burstToys = listedToys.filter(
    (toy) => typeof toy?.name === 'string' && toy.name.startsWith(`${burstPrefix}-`),
  );

  let cleanupDeletedCount = 0;
  if (SHOULD_CLEANUP) {
    for (const toy of burstToys) {
      if (!Number.isSafeInteger(Number(toy?.id))) continue;

      const deleteResponse = await fetchWithTimeout(
        buildApiUrl(baseUrl, `/api/toys/${Number(toy.id)}`),
        { method: 'DELETE' },
      );
      if (deleteResponse.status === 200) cleanupDeletedCount += 1;
    }
  }

  const summary = {
    baseUrl: baseUrl,
    burstPrefix,
    totalRequests: TOTAL_REQUESTS,
    concurrency: CONCURRENCY,
    distinctIps: USE_DISTINCT_IPS,
    createdCount: successResults.length,
    uniqueCreatedIds: uniqueCreatedIds.size,
    statusCounts: collectStatusCounts(createResults),
    listedBurstCount: burstToys.length,
    cleanupEnabled: SHOULD_CLEANUP,
    cleanupDeletedCount,
  };

  const fullSuccess =
    successResults.length === TOTAL_REQUESTS &&
    uniqueCreatedIds.size === successResults.length &&
    burstToys.length === successResults.length;

  return {
    summary,
    fullSuccess,
  };
}

let ownedDevProcess = null;

try {
  const hasRunningServer = await canReachServer(API_BASE_URL);
  if (hasRunningServer) {
    console.log(`[test:load] Reusing running server at ${API_BASE_URL}`);
  } else if (SHOULD_AUTOSTART) {
    console.log(`[test:load] No server detected at ${API_BASE_URL}. Starting wrangler dev...`);
    ownedDevProcess = startWranglerDev(API_BASE_URL);
    await waitForServerReady(API_BASE_URL, ownedDevProcess);
    console.log(`[test:load] Worker is ready at ${API_BASE_URL}`);
  } else {
    throw new Error(
      `Cannot reach API at ${API_BASE_URL} and LOAD_TEST_AUTOSTART is disabled. Start server manually or enable LOAD_TEST_AUTOSTART.`,
    );
  }

  const { summary, fullSuccess } = await createToyBurst(API_BASE_URL);
  console.log('[test:load] Summary');
  console.log(JSON.stringify(summary, null, 2));

  if (REQUIRE_FULL_SUCCESS && !fullSuccess) {
    process.exitCode = 1;
    console.error('[test:load] Load test failed full-success criteria.');
  } else {
    process.exitCode = 0;
  }
} catch (error) {
  process.exitCode = 1;
  console.error(`[test:load] ${error.message}`);
} finally {
  if (ownedDevProcess) {
    console.log('[test:load] Stopping auto-started wrangler dev...');
    await stopProcessGracefully(ownedDevProcess);
  }
}
