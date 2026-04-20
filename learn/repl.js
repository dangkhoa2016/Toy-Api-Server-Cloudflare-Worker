const { getPlatformProxy } = await import("wrangler");
const { KVService } = await import("./learn/kv_service.js");
const configPath = path.resolve('./', './wrangler.dev.toml');
const { env } = await getPlatformProxy({ configPath });
// const { env } = await getPlatformProxy({ environment: 'development' });
const kvService = new KVService(env.TOY_STATE);
const results1 = await kvService.kv.list();
const results2 = await kvService.listRaw();
