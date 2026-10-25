// 入力の画面の定義の形（作業の層）。段階 → 区画 → まとまり（物1件など）→ 欄。
// 欄は「入力項目ID（0004・registry/items.yaml）・名前・単位・読み方・書き方」をまとめた定義で、画面の部品はこの定義だけを見て描く。
// 欄の読み方（get）と書き方（set）は世帯の要求（0008 の形）を直接読み書きする。書き方は元の値を変えず新しい世帯を返す
import type { Box, Household, Member, Timepoint } from "../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth } from "../levers.ts";
import type { Estimate } from "./estimates.ts";
import { boxBasis, confirmedBox, estimatedBox, mutate, type WorkingHousehold } from "./household.ts";
import { sameRate, type YenBasis, type YenUnit } from "./units.ts";

export type Level = "simple" | "detail";
export type Val = number | string | boolean | null;

export interface Option {
  value: string;
  label: string;
}

export interface FieldState {
  value: Val;
  /** 推定の値（0008 の2）なら根拠の文 */
  estimated?: string | null;
  /** 箱を持たない項目の仮の値なら理由 */
  assumed?: string | null;
  /** 表示の値から元の形に戻せない（年齢・イベントで決めた時点を年月で見せているなど）。書き換えると年月の形になる */
  derived?: string | null;
  /** 欄の横に添える補助（年齢・和暦など） */
  hint?: string | null;
  /** 省略時の既定の値を見せている（書き戻すと省略に戻る） */
  implicit?: boolean;
  /** ほかの入力と合わないときの知らせ（例: 住宅ローンの借入額と購入の予定の価格−頭金） */
  warn?: string | null;
}

interface FieldBase {
  /** 世帯の中で一意の欄のキー（段階/物の ID/項目） */
  key: string;
  /** 入力項目ID（0004）。画面の側だけの値（呼び名など）は null */
  item: string | null;
  label: string;
  level: Level;
  help?: string;
  /** 空にできる（空は「入れない」。推定の値があれば推定に戻る） */
  optional?: boolean;
  /** 物の形が変わる選択（年金の入れ方・働き方の種類など）。往復のテストでは別に確かめる */
  structural?: boolean;
  /** 空にすると推定の値に戻る（空は「入れない」ではない） */
  blankIsEstimate?: boolean;
  /** 見せるだけの欄（書き換えられない）。その理由 */
  readOnly?: string;
  /** ほかの値もいっしょに変える欄（例: 働く最後の年齢は、退職後の生活費の節目・積立の終わりも合わせる）。その説明 */
  sideEffects?: string;
  get: (wh: WorkingHousehold) => FieldState;
  set: (wh: WorkingHousehold, v: Val) => WorkingHousehold;
}

export type FieldDef = FieldBase &
  (
    | { kind: "yen"; basis: YenBasis; unit?: YenUnit }
    | { kind: "int"; suffix?: string; min?: number; max?: number }
    | { kind: "pct" }
    | { kind: "decimal"; suffix?: string }
    | { kind: "select"; options: Option[] }
    | { kind: "ym" }
    | { kind: "bool" }
    | { kind: "text"; placeholder?: string }
  );

export interface ActionDef {
  key: string;
  label: string;
  level: Level;
  run: (wh: WorkingHousehold) => WorkingHousehold;
  danger?: boolean;
  /** 選んでいる状態を見せるボタン（目安の選択など。aria-pressed） */
  pressed?: boolean;
  /** ボタンに添える補足（ツールチップ） */
  title?: string;
}

/** まとまり（物1件、または区画の中の1組の欄） */
export interface GroupDef {
  key: string;
  title?: string;
  /** まとまりの説明（推定の根拠・注意など） */
  note?: string;
  level: Level;
  fields: FieldDef[];
  actions: ActionDef[];
}

export interface SectionDef {
  key: string;
  title: string;
  note?: string;
  level: Level;
  groups: GroupDef[];
  actions: ActionDef[];
}

export type StageId = "family" | "work" | "pension" | "living" | "education" | "housing" | "insurance" | "savings" | "events" | "car" | "fee" | "assumptions";

export interface StageDef {
  id: StageId;
  label: string;
  lead: string;
  sections: SectionDef[];
}

// ---- 値の比べ方 ----

export function sameVal(a: Val, b: Val, kind: FieldDef["kind"]): boolean {
  if (kind === "pct" || kind === "decimal") return sameRate(a as string | null, b as string | null);
  return a === b;
}

/** 欄を作る: 同じ値を入れ直しても世帯を変えない（推定の値を同じ値で入れ直したときは「確定」にする） */
export function field(def: FieldDef): FieldDef {
  const raw = def.set;
  return {
    ...def,
    set: (wh, v) => {
      const cur = def.get(wh);
      if (sameVal(cur.value, v, def.kind) && cur.estimated == null && cur.assumed == null) return wh;
      const next = raw(wh, v);
      if (cur.assumed != null && wh.assumed[def.key] !== undefined) {
        const { [def.key]: _drop, ...rest } = next.assumed;
        void _drop;
        return { ...next, assumed: rest };
      }
      return next;
    },
  };
}

// ---- 入れ子の値の読み書き ----

type Obj = Record<string, unknown>;

export function getPath(o: unknown, path: readonly string[]): unknown {
  let cur = o;
  for (const p of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Obj)[p];
  }
  return cur;
}

/** 値を置く。undefined は消し、空になった入れ物も消す */
export function setPath(o: Obj, path: readonly string[], value: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    if (value === undefined) delete o[head];
    else o[head] = value;
    return;
  }
  let child = o[head];
  if (child === null || typeof child !== "object") {
    if (value === undefined) return;
    child = {};
    o[head] = child;
  }
  setPath(child as Obj, rest, value);
  if (value === undefined && Object.keys(child as Obj).length === 0) delete o[head];
}

/** 世帯の中の物（1件）を探す関数。書くときは複製した世帯で同じ関数を使う */
export type Finder = (h: Household, wh: WorkingHousehold) => Obj | undefined;

/** 値の箱（0008 の2）の円の欄 */
export function yenBox(o: {
  key: string;
  item: string;
  label: string;
  level: Level;
  basis: YenBasis;
  unit?: YenUnit;
  help?: string;
  find: Finder;
  path: readonly string[];
  /** 物が無いときに作る（無ければ書けない） */
  ensure?: (h: Household, wh: WorkingHousehold) => Obj;
  /** 空にしたときの推定の値 */
  estimate?: (h: Household, wh: WorkingHousehold) => Estimate | null;
  optional?: boolean;
  /** 欄の横に添える補助（目安など） */
  hint?: (wh: WorkingHousehold) => string | null;
}): FieldDef {
  return field({
    key: o.key,
    item: o.item,
    label: o.label,
    level: o.level,
    kind: "yen",
    basis: o.basis,
    ...(o.unit !== undefined ? { unit: o.unit } : {}),
    ...(o.help !== undefined ? { help: o.help } : {}),
    optional: o.optional === true || o.estimate !== undefined,
    ...(o.estimate !== undefined ? { blankIsEstimate: true } : {}),
    get: (wh) => {
      const box = getPath(o.find(wh.request.input.household, wh), o.path) as Box<number> | undefined;
      const value = box?.value ?? (box?.state === "unknown" ? ((box as { substitute?: Box<number> }).substitute?.value ?? null) : null);
      return { value, estimated: boxBasis(box) ?? (box?.state === "unknown" ? "わからない（代わりの値）" : null), ...(o.hint !== undefined ? { hint: o.hint(wh) } : {}) };
    },
    set: (wh, v) =>
      mutate(wh, (h, req) => {
        const w2 = { ...wh, request: req };
        const target = o.find(h, w2) ?? o.ensure?.(h, w2);
        if (target === undefined) return;
        if (v === null) {
          const est = o.estimate?.(h, wh) ?? null;
          setPath(target, o.path, est !== null ? estimatedBox(est.value, est.basis) : undefined);
        } else setPath(target, o.path, confirmedBox(Number(v)));
      }),
  });
}

/** 値の箱（0008 の2）の率の欄（百分率で見せる） */
export function rateBox(o: { key: string; item: string; label: string; level: Level; help?: string; find: Finder; path: readonly string[]; optional?: boolean }): FieldDef {
  return field({
    key: o.key,
    item: o.item,
    label: o.label,
    level: o.level,
    kind: "pct",
    ...(o.help !== undefined ? { help: o.help } : {}),
    ...(o.optional === true ? { optional: true } : {}),
    get: (wh) => {
      const box = getPath(o.find(wh.request.input.household, wh), o.path) as { value?: string; state?: string; estimate?: { basis?: string } } | undefined;
      return { value: box?.value ?? null, estimated: box?.state === "estimated" ? (box.estimate?.basis ?? "推定") : null };
    },
    set: (wh, v) =>
      mutate(wh, (h, req) => {
        const target = o.find(h, { ...wh, request: req });
        if (target === undefined) return;
        setPath(target, o.path, v === null ? undefined : { value: String(v), state: "confirmed", origin: { kind: "manual" } });
      }),
  });
}

/** 箱でない値（数・文字・真偽・選択）の欄 */
export function plain(o: {
  key: string;
  item: string | null;
  label: string;
  level: Level;
  kind: "int" | "pct" | "decimal" | "select" | "ym" | "bool" | "text" | "yen";
  basis?: YenBasis;
  options?: Option[];
  suffix?: string;
  min?: number;
  max?: number;
  help?: string;
  find: Finder;
  path: readonly string[];
  ensure?: (h: Household, wh: WorkingHousehold) => Obj;
  optional?: boolean;
  structural?: boolean;
  /** 空の値（undefined）のときに見せる値（省略時の既定） */
  fallback?: Val;
  hint?: (v: Val, wh: WorkingHousehold) => string | null;
  /** 値を書いた後の始末（関連する値の調整） */
  after?: (h: Household, target: Obj, v: Val, wh: WorkingHousehold) => void;
}): FieldDef {
  const kindPart: Record<string, unknown> = { kind: o.kind };
  if (o.kind === "yen") kindPart.basis = o.basis ?? "once";
  if (o.kind === "select") kindPart.options = o.options ?? [];
  if (o.suffix !== undefined) kindPart.suffix = o.suffix;
  if (o.min !== undefined) kindPart.min = o.min;
  if (o.max !== undefined) kindPart.max = o.max;
  return field({
    key: o.key,
    item: o.item,
    label: o.label,
    level: o.level,
    ...(o.help !== undefined ? { help: o.help } : {}),
    ...(o.optional === true ? { optional: true } : {}),
    ...(o.structural === true ? { structural: true } : {}),
    ...(kindPart as { kind: "int" }),
    get: (wh) => {
      const raw = getPath(o.find(wh.request.input.household, wh), o.path);
      const value = (raw === undefined || raw === null ? (o.fallback ?? null) : raw) as Val;
      return { value, hint: o.hint?.(value, wh) ?? null, assumed: wh.assumed[o.key] ?? null, ...(o.fallback !== undefined && (raw === undefined || raw === null || raw === o.fallback) ? { implicit: true } : {}) };
    },
    set: (wh, v) =>
      mutate(wh, (h, req) => {
        const w2 = { ...wh, request: req };
        const target = o.find(h, w2) ?? o.ensure?.(h, w2);
        if (target === undefined) return;
        const none = v === null || (v === "" && o.optional === true) || (o.fallback !== undefined && v === o.fallback);
        setPath(target, o.path, none ? undefined : v);
        o.after?.(h, target, v, wh);
      }),
  });
}

// ---- 時点（0003 の6）----

/** 時点を年月にする（年齢・イベントで決めた時点も解く）。解けなければ null */
export function resolveTimepoint(h: Household, t: Timepoint | null | undefined): string | null {
  if (t == null) return null;
  if (t.at !== undefined) return t.at;
  if (t.memberAge !== undefined) {
    const m = h.members.find((x) => x.id === t.memberAge?.member);
    return m === undefined ? null : addMonths(ageReachedMonth(m, t.memberAge.years), t.memberAge.months ?? 0);
  }
  if (t.event !== undefined) {
    const e = (h.events ?? []).find((x) => x.id === t.event);
    const base = resolveTimepoint(h, e?.at);
    const off = (t as { offset?: { years?: number; months?: number } }).offset;
    return base === null ? null : addMonths(base, (off?.years ?? 0) * 12 + (off?.months ?? 0));
  }
  return null;
}

/** 時点の欄（年月で入れる。年齢・イベントで決めた時点は年月で見せ、書き換えると年月の形にする） */
export function timepointField(o: {
  key: string;
  item: string;
  label: string;
  level: Level;
  find: Finder;
  path: readonly string[];
  /** 年齢を添える構成員 */
  ageOf?: (h: Household) => Member | undefined;
  optional?: boolean;
  help?: string;
  /** 空（null）のときの意味（例: 「最後まで」） */
  nullText?: string;
  /** 空にしたら欄ごと消す（null を書かない項目） */
  absentWhenEmpty?: boolean;
  after?: (h: Household, target: Obj, v: Val, wh: WorkingHousehold) => void;
}): FieldDef {
  return field({
    key: o.key,
    item: o.item,
    label: o.label,
    level: o.level,
    kind: "ym",
    ...(o.help !== undefined ? { help: o.help } : {}),
    ...(o.optional === true ? { optional: true } : {}),
    get: (wh) => {
      const h = wh.request.input.household;
      const t = getPath(o.find(h, wh), o.path) as Timepoint | null | undefined;
      const ym = resolveTimepoint(h, t);
      const who = o.ageOf?.(h);
      const age = ym !== null && who !== undefined ? `${ageAt(who, ym)}歳` : null;
      const derived = t != null && t.at === undefined ? (t.memberAge !== undefined ? "年齢で決めた時点" : "イベントで決めた時点") : null;
      return { value: ym, hint: ym === null ? (o.nullText ?? null) : age, derived, ...(ym === null && o.optional === true ? { implicit: true } : {}) };
    },
    set: (wh, v) =>
      mutate(wh, (h, req) => {
        const target = o.find(h, { ...wh, request: req });
        if (target === undefined) return;
        setPath(target, o.path, v === null ? (o.optional === true && o.absentWhenEmpty !== true ? null : undefined) : { at: String(v) });
        o.after?.(h, target, v, wh);
      }),
  });
}

/** 配列の中から ID で物を探す Finder */
export function byId(list: (h: Household) => unknown[] | undefined, id: string): Finder {
  return (h) => (list(h) ?? []).find((x) => (x as Obj).id === id) as Obj | undefined;
}

export function removeAction(key: string, label: string, level: Level, run: (h: Household, wh: WorkingHousehold) => WorkingHousehold | void): ActionDef {
  return {
    key,
    label,
    level,
    danger: true,
    run: (wh) => {
      let out: WorkingHousehold | null = null;
      const next = mutate(wh, (h) => {
        const r = run(h, wh);
        if (r) out = r;
      });
      return out ?? next;
    },
  };
}

/** 段階の全部の欄（テスト・数え上げ用） */
export function allFields(stage: StageDef): FieldDef[] {
  return stage.sections.flatMap((s) => s.groups.flatMap((g) => g.fields));
}
