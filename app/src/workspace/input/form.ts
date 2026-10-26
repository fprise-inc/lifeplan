// 入力の画面の定義の形（作業の層）。段階 → 区画 → まとまり（物1件など）→ 欄。
// 欄は「入力項目ID（0004・registry/items.yaml）・名前・単位・読み方・書き方」をまとめた定義で、画面の部品はこの定義だけを見て描く。
// 欄の読み方（get）と書き方（set）は世帯の要求（0008 の形）を直接読み書きする。書き方は元の値を変えず新しい世帯を返す
import type { Box, Household, Member, Timepoint } from "../../engine/types.ts";
import { ageAt } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import type { Estimate } from "./estimates.ts";
import { boxBasis, confirmedBox, estimatedBox, mutate, newId, type WorkingHousehold } from "./household.ts";
import { eventChoices, materializeEvent, pointsToCandidate, refsTo, whenPeople } from "./namedEvents.ts";
import { sameRate, type YenBasis, type YenUnit } from "./units.ts";
import { readWhen, sameWhen, WHEN_MODES, type AgeMeans, type WhenCtx, type WhenMode } from "./when.ts";

export { resolveTimepoint };
import type { Address } from "../store/readings.ts";
import { dropStaleRows } from "./rows.ts";

export type Level = "simple" | "detail";
/** 欄の値。時点の欄（kind "when"）は時点の型（0003 の6）そのものも受ける（年月の文字は {at} として読む） */
export type Val = number | string | boolean | null | Timepoint;

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
  /** 時点の欄（kind "when"）の、入れた形のままの時点と読み方 */
  when?: WhenState;
}

/** 時点の欄の状態（時点の部品が描くのに使う） */
export interface WhenState {
  /** 世帯に入っている形のままの時点（空は null） */
  raw: Timepoint | null;
  /** 読み取り・見せ方の文脈（人・出来事の一覧・入れ方） */
  ctx: WhenCtx;
  /** 欄の下に出す読み替えた形 */
  read: string;
  /** この欄が出来事そのものの時点（出来事が正本）。直すと出来事が動き、指している物も動く。at は出来事の時点（欄にはこれを見せる） */
  linked: { event: string; label: string; refs: number; at: Timepoint } | null;
}

/** 時点の部品で入れる欄の、読み書き（0038） */
export interface TimeView {
  when: WhenSpec;
  state: (wh: WorkingHousehold) => WhenState;
  /** 時点を書く。how "auto" は出来事が正本の欄なら出来事を動かし、"this" はこの欄だけ（出来事から切り離す。入れ方を選び直したとき） */
  setWhen: (wh: WorkingHousehold, tp: Timepoint | null, how: "auto" | "this") => WorkingHousehold;
}

/** 時点の欄の決まり（欄ごと。0038） */
export interface WhenSpec {
  defaultMode: WhenMode;
  modes: readonly WhenMode[];
  ageMeans: AgeMeans;
  /** 空（null）のときの意味（例: 「最後まで」） */
  nullText?: string;
  /** この欄が正本になる出来事の種類（子の独立 independence・入居 moveIn など）。出来事を指しているとき、直すと出来事を動かす */
  anchor?: string;
  /** 年月にして持つ欄（読む所が年月の形を前提にしている）。その理由（欄の下に出す） */
  monthOnly?: string;
  /** 入れられない時点の理由（欄ごとの範囲など）。入れられれば null */
  check?: (wh: WorkingHousehold, tp: Timepoint | null) => string | null;
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
  /**
   * 時点の部品（0038）で入れる欄。kind "when" の欄（時点そのものの欄）と、年齢・年数の整数の欄（定年・働く最後・年金の受け取り開始・
   * 車を手放す年齢など。結果のタブで動かす項目は整数のまま）が持つ。入力の画面はこれがあれば時点の部品で描く
   */
  time?: TimeView;
  get: (wh: WorkingHousehold) => FieldState;
  /** 値を書く（打った・選んだ・ボタンで変えたとき）。同じ値なら世帯を変えない（状態も変えない。0035 の3・0041） */
  set: (wh: WorkingHousehold, v: Val) => WorkingHousehold;
  /** 同じ値の確かめをしない書き方（field() が付ける。値の状態の操作「推定に戻す」などが使う。valueState.ts） */
  write?: (wh: WorkingHousehold, v: Val) => WorkingHousehold;
  /** 値の箱（0008 の2）の欄の、箱そのものの読み書き（yenBox・rateBox が付ける。値の状態の操作が使う） */
  boxed?: { read: (wh: WorkingHousehold) => unknown; write: (wh: WorkingHousehold, box: Record<string, unknown> | undefined) => WorkingHousehold };
  /** 欄の当て先（0036 の2）。省くと 0.16 の欄のキーから読み替え表で引く（valueState.ts の fieldAddress） */
  address?: (wh: WorkingHousehold) => Address | null;
}

export type FieldDef = FieldBase &
  (
    | { kind: "yen"; basis: YenBasis; unit?: YenUnit }
    | { kind: "int"; suffix?: string; min?: number; max?: number }
    | { kind: "pct" }
    | { kind: "decimal"; suffix?: string }
    | { kind: "select"; options: Option[] }
    | { kind: "ym" }
    | { kind: "when" }
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
  if ((a !== null && typeof a === "object") || (b !== null && typeof b === "object")) return sameWhen(a as Timepoint | null, b as Timepoint | null);
  return a === b;
}

/**
 * 欄を作る: 同じ値を入れ直しても世帯を変えない（推定の値と同じ値を書き戻しても確定にしない。確定は「✓ この値で確定」だけ。0035 の3・0041）。
 * 値を変えたら、その欄の仮の印を外し、値が変わった所の値の状態の行（わからない・該当なし・承認など）を外す（rows.ts の dropStaleRows）
 */
export function field(def: FieldDef): FieldDef {
  const raw = def.set;
  const write = (wh: WorkingHousehold, v: Val): WorkingHousehold => {
    const next = raw(wh, v);
    if (next === wh) return wh;
    // 仮の印を欄の get で見せている欄（plain など）は、書いたら印を外す。印を自分で付け外しする欄（車・借入額）は、その書き方に任せる
    const own = def.get(wh).assumed != null && next.assumed[def.key] === wh.assumed[def.key];
    const cleared = own ? { ...next, assumed: Object.fromEntries(Object.entries(next.assumed).filter(([k]) => k !== def.key)) } : next;
    return dropStaleRows(wh, cleared);
  };
  return {
    ...def,
    write,
    set: (wh, v) => {
      const cur = def.get(wh);
      // 時点の欄は、時点の形で渡されたら入っている形と比べる（年月の文字なら年月で比べる）。同じなら推定でも何も変えない（0041）
      const now = def.kind === "when" && typeof v === "object" ? (cur.when?.raw ?? null) : cur.value;
      if (sameVal(now, v, def.kind)) return wh;
      return write(wh, v);
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

/** 値の箱の欄の、箱そのものの読み書き（値の状態の操作が使う）。箱を消すときは undefined */
function boxAccess(find: Finder, path: readonly string[], ensure?: (h: Household, wh: WorkingHousehold) => Obj): NonNullable<FieldBase["boxed"]> {
  return {
    read: (wh) => getPath(find(wh.request.input.household, wh), path),
    write: (wh, box) =>
      mutate(wh, (h, req) => {
        const w2 = { ...wh, request: req };
        const target = find(h, w2) ?? (box !== undefined ? ensure?.(h, w2) : undefined);
        if (target === undefined) return;
        setPath(target, path, box === undefined ? undefined : structuredClone(box));
      }),
  };
}

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
    boxed: boxAccess(o.find, o.path, o.ensure),
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
      const box = getPath(o.find(wh.request.input.household, wh), o.path) as { value?: string; state?: string; estimate?: { basis?: string }; substitute?: { value?: string } } | undefined;
      if (box?.state === "unknown") return { value: box.substitute?.value ?? null, estimated: "わからない（代わりの値）" };
      return { value: box?.value ?? null, estimated: box?.state === "estimated" ? (box.estimate?.basis ?? "推定") : null };
    },
    boxed: boxAccess(o.find, o.path),
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

// ---- 時点（0003 の6）・時点の部品（0038）----

/** 欄の値を時点にする（年月の文字は {at}。読めなければ undefined） */
export function toTimepoint(v: Val): Timepoint | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v === "object") return v;
  if (typeof v === "string" && /^\d{4}-\d{2}$/.test(v)) return { at: v };
  return undefined;
}

/** 時点の欄の読み取りの文脈（人・出来事の一覧・既定の入れ方） */
export function whenContext(wh: WorkingHousehold, spec: WhenSpec, o: { person?: string | null; optional?: boolean; start?: Timepoint | null; current?: Timepoint | null; excludeEvent?: string }): WhenCtx {
  const h = wh.request.input.household;
  return {
    h,
    baseMonth: wh.request.input.baseMonth,
    people: whenPeople(wh),
    person: o.person ?? null,
    events: spec.modes.includes("event") ? eventChoices(wh, o.excludeEvent !== undefined ? { exclude: o.excludeEvent } : {}) : [],
    modes: spec.modes,
    defaultMode: spec.defaultMode,
    ageMeans: spec.ageMeans,
    optional: o.optional === true,
    ...(o.start !== undefined ? { start: o.start } : {}),
    ...(o.current !== undefined ? { current: o.current } : {}),
  };
}

/** 出来事が正本の欄の、今指している出来事（ずらしの無い出来事の形で、種類が欄の正本の種類と同じとき） */
function linkedEvent(h: Household, spec: WhenSpec, t: Timepoint | null | undefined) {
  if (spec.anchor === undefined || t?.event === undefined || (t.offset?.years ?? 0) * 12 + (t.offset?.months ?? 0) !== 0) return undefined;
  const e = (h.events ?? []).find((x) => x.id === t.event);
  return e !== undefined && e.kind === spec.anchor ? e : undefined;
}

/** 時点の部品の欄の決まり（timepointField・timeView に共通） */
export interface WhenOptions {
  /** 年齢で入れるときの既定の人（年齢を添える構成員） */
  ageOf?: (h: Household) => Member | undefined;
  optional?: boolean;
  /** 空（null）のときの意味（例: 「最後まで」） */
  nullText?: string;
  /** 既定の入れ方（既定: 人がいれば年齢、いなければ年月） */
  mode?: WhenMode;
  /** 使える入れ方（既定: 4つとも） */
  modes?: readonly WhenMode[];
  /** 「60歳」がどの月か（既定 reach）。働く最後のような「○歳まで」の欄は before、年金の受け取り開始は after */
  ageMeans?: AgeMeans;
  anchor?: string;
  monthOnly?: string;
  check?: (wh: WorkingHousehold, tp: Timepoint | null) => string | null;
  /** 空のときに、読み替えた形の代わりに見せる省略のときの時点（例: 年金の受け取り開始は65歳になった翌月） */
  fallback?: (h: Household) => Timepoint | null;
}

const specOf = (o: WhenOptions): WhenSpec => ({
  defaultMode: o.mode ?? (o.ageOf !== undefined ? "age" : "ym"),
  modes: o.modes ?? WHEN_MODES,
  ageMeans: o.ageMeans ?? "reach",
  ...(o.nullText !== undefined ? { nullText: o.nullText } : {}),
  ...(o.anchor !== undefined ? { anchor: o.anchor } : {}),
  ...(o.monthOnly !== undefined ? { monthOnly: o.monthOnly } : {}),
  ...(o.check !== undefined ? { check: o.check } : {}),
});

/**
 * 時点の部品の読み書きを作る（0038）。read は欄に入っている形のままの時点、write はその時点を欄に書く（出来事のことは知らなくてよい）。
 * 出来事が正本の欄で出来事を指しているときに年月・年齢を入れたら出来事のほうを動かし、まだ出来事でない物を選んだら出来事にしてから書く
 */
export function timeView(o: WhenOptions & { read: (wh: WorkingHousehold) => Timepoint | null; write: (wh: WorkingHousehold, tp: Timepoint | null) => WorkingHousehold; start?: (wh: WorkingHousehold) => Timepoint | null | undefined }): TimeView {
  const spec = specOf(o);
  const state = (wh: WorkingHousehold): WhenState => {
    const h = wh.request.input.household;
    const t = o.read(wh);
    const start = o.start?.(wh);
    const ctx = whenContext(wh, spec, { person: o.ageOf?.(h)?.id ?? null, optional: o.optional === true, current: t, ...(start !== undefined ? { start } : {}) });
    const ev = linkedEvent(h, spec, t);
    const linked = ev === undefined ? null : { event: ev.id, label: ctx.events.find((e) => e.id === ev.id)?.label ?? "出来事", refs: refsTo(h, ev.id), at: ev.at };
    const fb = t === null ? (o.fallback?.(h) ?? null) : null;
    const read = fb !== null ? `${o.nullText ?? "空欄"}: ${readWhen(fb, ctx)}` : linked !== null ? readWhen(linked.at, { ...ctx, current: linked.at }) : readWhen(t, ctx, o.nullText);
    return { raw: t, ctx, read, linked };
  };
  const setWhen = (wh: WorkingHousehold, tp: Timepoint | null, how: "auto" | "this"): WorkingHousehold => {
    const h0 = wh.request.input.household;
    const cur = o.read(wh);
    let want = tp;
    if (want !== null && o.monthOnly !== undefined && want.at === undefined && !pointsToCandidate(want)) {
      const ym = resolveTimepoint(h0, want);
      if (ym === null) return wh;
      want = { at: ym };
    }
    // 出来事が正本の欄: 出来事を指したまま年月・年齢を入れたら、出来事のほうを動かす（指している物が全部動く）
    const ev = how === "auto" && want !== null && want.event === undefined ? linkedEvent(h0, spec, cur) : undefined;
    if (ev !== undefined && want !== null) {
      if (sameWhen(ev.at, want)) return wh;
      const next = want;
      return mutate(wh, (h) => {
        const e = (h.events ?? []).find((x) => x.id === ev.id);
        if (e !== undefined) e.at = structuredClone(next);
      });
    }
    // 同じ時点を入れ直しても世帯を変えない
    if (!pointsToCandidate(want) && sameWhen(cur, want)) return wh;
    // まだ出来事でない物（子の独立など）を選んだら、出来事にしてから指す
    if (want !== null && pointsToCandidate(want)) {
      let made: Timepoint | null = null;
      const w1 = mutate(wh, (h) => {
        made = materializeEvent(h, want as Timepoint, newId);
      });
      if (made === null) return wh;
      return o.write(w1, made);
    }
    return o.write(wh, want === null ? null : structuredClone(want));
  };
  return { when: spec, state, setWhen };
}

/**
 * 時点の欄（0038 の時点の部品）。どの「いつ」の欄も同じ部品で入れる: 年月・人の年齢・出来事から・今から。
 * 書く値はエンジンの時点の型のまま（年齢・出来事で入れた時点は年齢・出来事で持つ。今からは年月にする）。
 * 欄の値（value）は年月に解いた "YYYY-MM"（ほかの読み手のため）、入っている形のままの時点は when.raw
 */
export function timepointField(
  o: WhenOptions & {
    key: string;
    item: string;
    label: string;
    level: Level;
    find: Finder;
    path: readonly string[];
    help?: string;
    /** 空にしたら欄ごと消す（null を書かない項目） */
    absentWhenEmpty?: boolean;
    after?: (h: Household, target: Obj, v: Val, wh: WorkingHousehold) => void;
    /** 終わりの欄: 同じ物の中の始まりの時点の場所（「10年間」で入れられる） */
    startPath?: readonly string[];
    /** ほかの入力と合わないときの知らせ */
    warn?: (wh: WorkingHousehold) => string | null;
  },
): FieldDef {
  const read = (wh: WorkingHousehold) => (getPath(o.find(wh.request.input.household, wh), o.path) as Timepoint | null | undefined) ?? null;
  const time = timeView({
    ...o,
    read,
    write: (wh, tp) =>
      mutate(wh, (h, req) => {
        const target = o.find(h, { ...wh, request: req });
        if (target === undefined) return;
        setPath(target, o.path, tp === null ? (o.optional === true && o.absentWhenEmpty !== true ? null : undefined) : tp);
        o.after?.(h, target, tp, wh);
      }),
    ...(o.startPath !== undefined ? { start: (wh: WorkingHousehold) => (getPath(o.find(wh.request.input.household, wh), o.startPath as readonly string[]) as Timepoint | null | undefined) ?? null } : {}),
  });
  return field({
    key: o.key,
    item: o.item,
    label: o.label,
    level: o.level,
    kind: "when",
    time,
    ...(o.help !== undefined ? { help: o.help } : {}),
    ...(o.optional === true ? { optional: true } : {}),
    get: (wh) => {
      const h = wh.request.input.household;
      const t = read(wh);
      const ym = resolveTimepoint(h, t ?? o.fallback?.(h));
      const who = o.ageOf?.(h);
      return {
        value: ym,
        hint: ym === null ? (o.nullText ?? null) : who !== undefined ? `${ageAt(who, ym)}歳` : null,
        when: time.state(wh),
        ...(t === null && o.optional === true ? { implicit: true } : {}),
        ...(o.warn !== undefined ? { warn: o.warn(wh) } : {}),
      };
    },
    set: (wh, v) => {
      const tp = toTimepoint(v);
      return tp === undefined ? wh : time.setWhen(wh, tp, "auto");
    },
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
