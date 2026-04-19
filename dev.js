import { execSync } from 'child_process';
import { getPlatformProxy } from 'wrangler';
import { fileURLToPath } from 'node:url';

const configPath = fileURLToPath(new URL('./wrangler.template.toml', import.meta.url));

// Keys whose values should be partially masked before printing.
const SENSITIVE_KEYS = new Set([
  'ELASTICSEARCH_URL',
  'DEBUG_SLEEP_SECRET',
]);

function mask_value(key, value) {
  if (!SENSITIVE_KEYS.has(key))
    return String(value);

  const str = String(value);

  if (str.length <= 8)
    return '***';

  // Keep first 4 and last 4 chars, mask the rest.
  return `${str.slice(0, 4)}${'*'.repeat(str.length - 8)}${str.slice(-4)}`;
}

function print_config_table(env) {
  const entries = Object.entries(env).filter(([, v]) => typeof v !== 'function' && typeof v !== 'object');

  if (entries.length === 0) {
    console.log('  (no plain vars loaded)');
    return;
  }

  const key_width = Math.max(...entries.map(([k]) => k.length), 10);

  console.log(`\n  ${'KEY'.padEnd(key_width)}  VALUE`);
  console.log(`  ${'─'.repeat(key_width)}  ${'─'.repeat(40)}`);

  for (const [key, value] of entries)
    console.log(`  ${key.padEnd(key_width)}  ${mask_value(key, value)}`);

  console.log();
}

(async () => {
  const { env, dispose } = await getPlatformProxy({ configPath });

  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║   Wrangler local config (from wrangler.template.toml + .dev.vars)  ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('\n');

  print_config_table(env);

  await dispose();

  // Start the worker with wrangler dev.
  execSync('wrangler dev --env development --config wrangler.template.toml', { stdio: 'inherit' });
})();
