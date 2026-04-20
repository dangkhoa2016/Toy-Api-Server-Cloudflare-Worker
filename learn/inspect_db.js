import { execSync } from 'child_process';
import { getPlatformProxy } from 'wrangler';
import crypto from 'crypto';
import { KVService } from './kv_service.js';
import { fileURLToPath } from 'node:url';
const configPath = fileURLToPath(new URL('../wrangler.template.toml', import.meta.url));

const LOCAL_TIMEZONE = process.env.LOCAL_TIMEZONE || 'Asia/Ho_Chi_Minh';

function deriveUtcOffset(timezone) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date());
  const offsetPart = parts.find((p) => p.type === 'timeZoneName');
  const match = offsetPart?.value?.match(/GMT([+-]\d{2}:\d{2})?/);
  return match?.[1] ?? '+00:00';
}

const LOCAL_TZ_OFFSET = deriveUtcOffset(LOCAL_TIMEZONE);
console.log(`Local timezone: ${LOCAL_TIMEZONE}, UTC offset: ${LOCAL_TZ_OFFSET}`);
// sql query for inspect
const inspectQuery = `
  SELECT
    key,
    blob_id,
    expiration,
    datetime(expiration / 1000, 'unixepoch') AS expiration_utc,
    datetime(expiration / 1000, 'unixepoch', '${LOCAL_TZ_OFFSET}') AS expiration_local,
    metadata
  FROM _mf_entries;
`;


function formatUnixSecondsToIso(unixSeconds, timezone = LOCAL_TIMEZONE) {
  const numeric = Number(unixSeconds);
  if (!Number.isFinite(numeric)) return 'invalid';

  const date = new Date(numeric * 1000);
  if (Number.isNaN(date.getTime())) return 'invalid';

  return date.toLocaleString('sv-SE', { timeZone: timezone });
}


function durableObjectNamespaceIdFromName(name) {
  const uniqueKey = 'miniflare-KVNamespaceObject';
  const key = crypto.createHash('sha256').update(uniqueKey).digest();
  const nameHmac = crypto.createHmac('sha256', key).update(name).digest().subarray(0, 16);
  const hmac = crypto.createHmac('sha256', key).update(nameHmac).digest().subarray(0, 16);
  return Buffer.concat([nameHmac, hmac]).toString('hex');
}

async function inspectkeys(kvService) {
  const results = await kvService.listRaw();
  const keysWithReadableExpiration = (results?.keys || []).map((item) => ({
    ...item,
    expiration_utc: formatUnixSecondsToIso(item.expiration, 'UTC'),
    expiration_local: formatUnixSecondsToIso(item.expiration, LOCAL_TIMEZONE),
  }));

  console.log('KV Namespace raw keys:', keysWithReadableExpiration);
  if (!results || Object.keys(results).length === 0) {
    console.log('No keys found in the KV Namespace.');
    return;
  }

  console.log('----------------------');
  console.log('Inspecting KV Namespace:');
  for (const item of results.keys) {
    console.log(`Getting raw value for key: ${item.name}`);
    const value = await kvService.getRaw(item.name);
    console.log(`Raw value: ${value}`);

    console.log(`Inspecting key: ${item.name}`);
    const json = await kvService.getWithMetadataRaw(item.name);
    console.log('Metadata:', json);
  }
}

function executeCommand(command) {
  try {
    const result = execSync(command, {
      encoding: 'utf8',
      cwd: process.cwd(),
      stdio: ['inherit', 'pipe', 'pipe']
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message, stderr: error.stderr };
  }
}

function inspectDatabase(file_name) {
  const databasePath = `.wrangler/state/v3/kv/miniflare-KVNamespaceObject/${file_name}.sqlite`;
  const normalizedQuery = inspectQuery.trim().replace(/\s+/g, ' ');
  const command = [
    `sqlite3 "${databasePath}"`,
    '-cmd ".headers on"',
    '-cmd ".mode table"',
    '-cmd ".nullvalue NULL"',
    `-cmd "${normalizedQuery}"`,
    '".exit"',
  ].join(' ');

  const result = executeCommand(command);
  if (result.success) {
    if (!result.output || result.output.trim() === '') {
      console.log('Database inspection output: (empty)');
      console.log('No rows found in _mf_entries for this local KV namespace.');
      return;
    }

    console.log('Database inspection output:');
    console.log(result.output);
  } else {
    console.error('Error inspecting database:', result.error);
    if (result.stderr) {
      console.error('Stderr:', result.stderr);
    }
  }
}

(async () => {
  const { env } = await getPlatformProxy({ configPath, environment: 'development' });
  console.log( env );
  /* output:
  {
    NODE_ENV: 'development',
    CORS_ORIGINS: 'http://localhost:3000,http://127.0.0.1:5173',
    RATE_LIMIT_ENABLED: 'true',
    RATE_LIMIT_MAX: '20',
    RATE_LIMIT_WINDOW_MS: '300000',
    MAX_ACTIVE_TOYS_GLOBAL: '500',
    MAX_TOYS_PER_IP: '5',
    SEED_MAX_TOYS_PER_IP: '15',
    SEED_WINDOW_MS: '600000',
    TOY_TTL_MS: '900000',
    TOY_CLEANUP_INTERVAL_MS: '120000',
    SECURITY_HEADERS_ENABLED: 'true',
    BASIC_AUTH_ENABLED: 'false',
    BASIC_AUTH_REALM: 'Toy API',
    TOY_STATE: ProxyStub { name: 'KvNamespace', poisoned: false },
    ASSETS: ProxyStub { name: 'Fetcher', poisoned: false }
  }
  */

  const kvService = new KVService(env.TOY_STATE);
  await inspectkeys(kvService);
  console.log('----------------------');

  const database_file_name = durableObjectNamespaceIdFromName('kv-local');
  console.log('database_file_name', database_file_name); // d99e661104a4a135ee593a9bcb0e7f7ed082f7b10baefc85f3cf00828813dd26
  console.log('----------------------');

  inspectDatabase(database_file_name);

  process.exit();

})();
