// 万一のときの扱い（onContingency。続ける・やめる・割合を変える）の欄。車・FP顧問料・周期的な支出で同じ形を使う（エンジンの設定をそのまま読み書きする）
import type { Household, OnContingency } from "../../../engine/types.ts";
import { field, getPath, plain, setPath, type FieldDef, type Finder, type Level, type Option } from "../form.ts";
import { mutate } from "../household.ts";

export const ON_CONTINGENCY_MODES: Option[] = [
  { value: "", label: "指定しない（続く）" },
  { value: "continue", label: "続ける" },
  { value: "stop", label: "やめる" },
  { value: "ratio", label: "割合を変える" },
];

export const ON_CONTINGENCY_KINDS: Option[] = [
  { value: "death", label: "死亡のときだけ" },
  { value: "all", label: "死亡・障害・就業不能のとき" },
];

/** 万一のときの扱いの欄（やり方・割合・当てる万一）。path は物の中の onContingency の場所 */
export function onContingencyFields(o: { key: string; item: string; find: Finder; path: readonly string[]; level?: Level; help?: string }): FieldDef[] {
  const level = o.level ?? "simple";
  const read = (h: Household, wh: Parameters<Finder>[1]) => getPath(o.find(h, wh), o.path) as OnContingency | undefined;
  const fields: FieldDef[] = [
    field({
      key: `${o.key}/mode`,
      item: o.item,
      label: "万一のときの扱い",
      level,
      kind: "select",
      options: ON_CONTINGENCY_MODES,
      help: o.help ?? "万一（死亡など）が起きた月の翌月から当てます",
      get: (wh) => ({ value: read(wh.request.input.household, wh)?.mode ?? "" }),
      set: (wh, v) =>
        mutate(wh, (h, req) => {
          const t = o.find(h, { ...wh, request: req });
          if (t === undefined) return;
          const cur = getPath(t, o.path) as OnContingency | undefined;
          if (v === "" || v === null) return setPath(t, o.path, undefined);
          const next: OnContingency = { mode: v as OnContingency["mode"] };
          if (v === "ratio") next.ratio = cur?.ratio ?? "0.5";
          if (cur?.kinds !== undefined) next.kinds = cur.kinds;
          setPath(t, o.path, next);
        }),
    }),
  ];
  return fields;
}

/** 割合と当てる万一（やり方が決まっているときだけ出す） */
export function onContingencyDetailFields(o: { key: string; item: string; find: Finder; path: readonly string[]; on: OnContingency | undefined; level?: Level }): FieldDef[] {
  if (o.on === undefined) return [];
  const out: FieldDef[] = [];
  if (o.on.mode === "ratio") out.push(plain({ key: `${o.key}/ratio`, item: o.item, label: "万一の後の割合（今の額に対して）", level: o.level ?? "simple", kind: "pct", find: o.find, path: [...o.path, "ratio"] }));
  out.push(
    field({
      key: `${o.key}/kinds`,
      item: o.item,
      label: "当てる万一",
      level: "detail",
      kind: "select",
      options: ON_CONTINGENCY_KINDS,
      get: (wh) => {
        const k = (getPath(o.find(wh.request.input.household, wh), o.path) as OnContingency | undefined)?.kinds;
        const onlyDeath = k === undefined || (k.length === 1 && k[0] === "death");
        return { value: onlyDeath ? "death" : "all", ...(onlyDeath ? { implicit: true } : {}) };
      },
      set: (wh, v) =>
        mutate(wh, (h, req) => {
          const t = getPath(o.find(h, { ...wh, request: req }), o.path) as OnContingency | undefined;
          if (t === undefined) return;
          if (v === "all") t.kinds = ["death", "disability", "incapacity"];
          else delete t.kinds;
        }),
    }),
  );
  return out;
}
