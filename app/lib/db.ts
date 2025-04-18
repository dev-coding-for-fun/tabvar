
import { Kysely, KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs, QueryResult, RootOperationNode, UnknownRow } from 'kysely';
import { D1Dialect } from 'kysely-d1'
import { DB } from './db.d'
import { AppLoadContext } from '@remix-run/cloudflare';

// Create a plugin to decode HTML entities
class HtmlDecodePlugin implements KyselyPlugin {
  private decodeHtml(text: string): string {
    const entities: Record<string, string> = {
      '&#39;': "'",
      '&quot;': '"',
      '&lt;': '<',
      '&gt;': '>',
      '&amp;': '&',
      '&#8217;': "'",
      // Add more entities if needed
    }
    return text.replace(/&#?\w+;/g, entity => entities[entity] || entity)
  }

  private transformValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.decodeHtml(value)
    }
    if (Array.isArray(value)) {
      return value.map(v => this.transformValue(v))
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, this.transformValue(v)])
      )
    }
    return value
  }

  public transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return {
      ...args.result,
      rows: args.result.rows.map(row => this.transformValue(row) as UnknownRow)
    }
  }
}

export function getDB(context: AppLoadContext) {
  const env = context.cloudflare.env as unknown as Env;
  return new Kysely<DB>({
    dialect: new D1Dialect({ database: env.DB }),
    plugins: [new HtmlDecodePlugin()],
    log(event) {
      if (event.level === 'query') {
        console.log(event.query.sql)
        console.log(event.query.parameters)
      }
      if (event.level === 'error') {
        console.error(event.error)
      }
    } 
  });
}
