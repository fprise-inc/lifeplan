// 万一のときの扱い（onContingency。続ける・やめる・割合を変える）の欄。車・FP顧問料・周期的な支出で同じ形を使う（エンジンの設定をそのまま読み書きする）
// 選択肢は3つ（入力項目をまたぐ言葉の決まり）: 「続ける（既定）」は空（省略）。前の世帯の mode "continue" も計算は同じなので「続ける」と読み、
// 書き換えない（別の扱いを選び直したときだけ書く。「続ける」を選ぶと空にする）
// 省略が「続ける」でない物（車: 名義の人が亡くなったら手放す。0173 の追記）は blank で省略の名前と読みを渡す。そのときは「続ける」（continue）を
// 省略と分けて書く
import type { Household, OnContingency } from "../../../engine/types.ts";
import { field, getPath, plain, setPath, type FieldDef, type Finder, type Level, type Option } from "../form.ts";
import { mutate } from "../household.ts";

export const ON_CONTINGENCY_MODES: Option[] = [
  { value: "", label: "続ける（既定）" },
  { value: "stop", label: "やめる" },
  { value: "ratio", label: "割合を変える" },
];

export const ON_CONTINGENCY_KINDS: Option[] = [
  { value: "death", label: "死亡のときだけ" },
  { value: "all", label: "死亡・障害・就業不能のとき" },
];

/** 省略が「続ける」でない物の、省略の選択肢の名前（label）と、省略のときに欄の横に出す読み（hint） */
export interface OnContingencyBlank {
  label: string;
  hint: string;
}

/** 万一のときの扱いの欄（やり方・割合・該当する万一）。path は物の中の onContingency の場所 */
export function onContingencyFields(o: { key: string; item: string; find: Finder; path: readonly string[]; level?: Level; help?: string; blank?: OnContingencyBlank }): FieldDef[] {
  const level = o.level ?? "simple";
  const read = (h: Household, wh: Parameters<Finder>[1]) => getPath(o.find(h, wh), o.path) as OnContingency | undefined;
  const blank = o.blank;
  const options: Option[] = blank === undefined ? ON_CONTINGENCY_MODES : [{ value: "", label: blank.label }, { value: "continue", label: "続ける" }, ...ON_CONTINGENCY_MODES.slice(1)];
  const fields: FieldDef[] = [
    field({
      key: `${o.key}/mode`,
      item: o.item,
      label: "万一のときの扱い",
      level,
      kind: "select",
      options,
      help: o.help ?? "万一（死亡など）が起きた月の翌月から、この扱いにします",
      // 空と "continue" は同じ「続ける」（計算はどちらも続く）。省略が続けるでない物は分ける
      get: (wh) => {
        const mode = read(wh.request.input.household, wh)?.mode;
        if (blank !== undefined) return { value: mode ?? "", hint: mode === undefined ? blank.hint : null };
        return { value: mode === undefined || mode === "continue" ? "" : mode };
      },
      set: (wh, v) =>
        mutate(wh, (h, req) => {
          const t = o.find(h, { ...wh, request: req });
          if (t === undefined) return;
          const cur = getPath(t, o.path) as OnContingency | undefined;
          if (blank !== undefined && v === "continue") return setPath(t, o.path, { mode: "continue" });
          if (v === "" || v === null || v === "continue") return setPath(t, o.path, undefined);
          const next: OnContingency = { mode: v as OnContingency["mode"] };
          if (v === "ratio") next.ratio = cur?.ratio ?? "0.5";
          if (cur?.kinds !== undefined) next.kinds = cur.kinds;
          setPath(t, o.path, next);
        }),
    }),
  ];
  return fields;
}

/** 割合と該当する万一（やり方が決まっているときだけ出す） */
export function onContingencyDetailFields(o: { key: string; item: string; find: Finder; path: readonly string[]; on: OnContingency | undefined; level?: Level }): FieldDef[] {
  // 続ける（空・前の世帯の "continue"）は割合も該当する万一も効かないので出さない
  if (o.on === undefined || o.on.mode === "continue") return [];
  const out: FieldDef[] = [];
  if (o.on.mode === "ratio") out.push(plain({ key: `${o.key}/ratio`, item: o.item, label: "万一の後の割合（今の額に対して）", level: o.level ?? "simple", kind: "pct", find: o.find, path: [...o.path, "ratio"] }));
  out.push(
    field({
      key: `${o.key}/kinds`,
      item: o.item,
      label: "該当する万一",
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
