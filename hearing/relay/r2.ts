// 本番の置き場（Cloudflare R2）。Workers の R2 の部品の型は、依存を増やさないよう使う所だけをここに書く
import type { RelayStore } from "./store.ts";

interface R2ObjectBody {
  text(): Promise<string>;
}
interface R2Objects {
  objects: { key: string; size: number }[];
  truncated: boolean;
  cursor?: string;
}
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: string, options?: { onlyIf?: Headers }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<R2Objects>;
}

export function r2Store(b: R2BucketLike): RelayStore {
  return {
    get: async (k) => {
      const o = await b.get(k);
      return o === null ? null : { text: await o.text() };
    },
    // 1回だけ書く: If-None-Match: * の条件つきで書き、もうあれば R2 は書かずに null を返す
    put: async (k, t, onlyIfAbsent) => (await b.put(k, t, onlyIfAbsent === true ? { onlyIf: new Headers({ "if-none-match": "*" }) } : undefined)) !== null,
    delete: async (keys) => {
      if (keys.length > 0) await b.delete([...keys]);
    },
    list: async (prefix) => {
      const out: { key: string; size: number }[] = [];
      let cursor: string | undefined;
      for (let n = 0; n < 10; n++) {
        const r = await b.list({ prefix, limit: 1000, ...(cursor !== undefined ? { cursor } : {}) });
        out.push(...r.objects.map((o) => ({ key: o.key, size: o.size })));
        if (!r.truncated) break;
        cursor = r.cursor;
      }
      return out;
    },
  };
}
