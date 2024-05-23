
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1'
import { DB } from 'kysely-codegen'
import { AppLoadContext } from '@remix-run/cloudflare';

export function getDB(context: AppLoadContext) {
  const env = context.cloudflare.env as unknown as Env;
  return new Kysely<DB>({
    dialect: new D1Dialect({ database: env.DB }),
  });
}
