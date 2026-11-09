import { createTelegramDispatchHandler } from "./core.mjs";

// Deploy with verify_jwt=false: the scheduled server request is authenticated by
// a high-entropy secret stored in Vault and checked by the handler before dispatch.
const handle = createTelegramDispatchHandler({
  env: { get: (name: string) => Deno.env.get(name) },
  fetcher: fetch,
});

Deno.serve(handle);
