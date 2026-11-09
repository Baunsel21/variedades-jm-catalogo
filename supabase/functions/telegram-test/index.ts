import { createTelegramTestHandler } from "./core.mjs";

const handle = createTelegramTestHandler({
  env: { get: (name: string) => Deno.env.get(name) },
  fetcher: fetch,
});

Deno.serve(handle);
