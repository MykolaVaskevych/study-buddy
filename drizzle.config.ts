import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit is a dev-time tool only: it diffs src/main/db/schema.ts into SQL files under drizzle/.
 * The app never reads drizzle/ at runtime; the SQL is embedded into src/main/db/migrations.ts.
 *
 *   npx drizzle-kit generate --name <change>      # schema change -> drizzle/NNNN_<change>.sql
 *   npx drizzle-kit generate --custom --name <x>  # hand-written SQL (FTS5, triggers, data fixes)
 *   npx tsx src/main/db/tools/embed-migrations.ts # re-embed drizzle/*.sql into migrations.ts
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true
})
