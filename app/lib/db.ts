
import { Kysely } from 'kysely';
import { Database } from './dbTypes'
import { D1Dialect } from 'kysely-d1'

export interface Env {
  DB: D1Database;
}

export function getDB(env: Env) {
  return new Kysely<Database>({
    dialect: new D1Dialect({ database: env.DB }),
  });
}
