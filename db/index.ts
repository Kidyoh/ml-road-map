import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";

// The WebSocket driver (rather than the HTTP one) because seed and the M3
// progress writes need real transactions. Node 22+ ships a global WebSocket, so
// no `ws` shim is required.
if (typeof WebSocket !== "undefined") {
  neonConfig.webSocketConstructor = WebSocket;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and paste your Neon connection string.",
  );
}

// Reuse the pool across hot reloads in dev, otherwise every edit leaks a pool
// and Neon starts refusing connections.
const globalForDb = globalThis as unknown as { pool?: Pool };

const pool = globalForDb.pool ?? new Pool({ connectionString });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
}

export const db = drizzle(pool, { schema });

export { schema };
