// 受け付けのサーバー（0125）の置き場の約束と、試し・開発用のサーバーのためのメモリの置き場。
// 本番は Cloudflare R2（r2.ts）。R2 は書いた直後から世界中で同じものが読める（強い整合）ので、1回だけの送信・一覧の大きさの確かめに使える
export interface StoredObject {
  readonly text: string;
}

export interface ListedObject {
  readonly key: string;
  readonly size: number;
}

export interface RelayStore {
  get(key: string): Promise<StoredObject | null>;
  /** onlyIfAbsent のとき、もうあれば書かずに false */
  put(key: string, text: string, onlyIfAbsent?: boolean): Promise<boolean>;
  delete(keys: readonly string[]): Promise<void>;
  list(prefix: string): Promise<ListedObject[]>;
}

/** メモリの置き場（試しと開発用のサーバー。再起動で消える） */
export function memoryStore(): RelayStore & { readonly size: () => number; readonly dump: () => ReadonlyMap<string, string> } {
  const m = new Map<string, string>();
  return {
    get: async (k) => (m.has(k) ? { text: m.get(k) as string } : null),
    put: async (k, t, onlyIfAbsent) => {
      if (onlyIfAbsent === true && m.has(k)) return false;
      m.set(k, t);
      return true;
    },
    delete: async (keys) => {
      for (const k of keys) m.delete(k);
    },
    list: async (prefix) => [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, t]) => ({ key, size: t.length })),
    size: () => m.size,
    dump: () => m,
  };
}
