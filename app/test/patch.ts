// テストの道具: 接続口の changes（JSON Patch の replace・add・remove。JSON Pointer の場所）を、計算の入力の写しに当てる。
// 接続口のテストと同じ見本の問いを、画面の側の関数で作るために使う（入力そのものは変えない）
export interface PatchOp {
  op: "replace" | "add" | "remove";
  path: string;
  value?: unknown;
}

export function applyPatch<T>(input: T, ops: readonly PatchOp[]): T {
  const out = structuredClone(input) as unknown;
  for (const x of ops) {
    const keys = x.path
      .slice(1)
      .split("/")
      .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    let o = out as Record<string, unknown> | unknown[];
    for (const k of keys.slice(0, -1)) o = (o as Record<string, unknown>)[k] as Record<string, unknown>;
    const last = keys[keys.length - 1] as string;
    if (Array.isArray(o)) {
      const i = last === "-" ? o.length : Number(last);
      if (x.op === "remove") o.splice(i, 1);
      else if (x.op === "add") o.splice(i, 0, x.value);
      else o[i] = x.value;
    } else if (x.op === "remove") delete o[last];
    else o[last] = x.value;
  }
  return out as T;
}
