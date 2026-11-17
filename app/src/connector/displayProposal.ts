// 表示の設定の案（AI接続口の propose_display_settings。0215・0213 の段C・段B の後半）: AI が出した、事務所の既定値の見せ方だけの設定18件の案と、
// 渡された世帯ごとの設定13件の案の値を、表示の設定の一覧（displayCatalog.ts）の選べる値・値の形で確かめ、get_display_settings の今の値
// （current.office.value・current.household.value）と同じ形にそろえる。
// - 接続口（plan.js の displayCheck。案をアプリに出す前）と、アプリの承認の画面（workspace/office/displayProposals.ts・workspace/ai/displayProposals.ts。
//   反映する前）が同じ関数を使う
// - 世帯ごとの案（target: household）は、対策に足した項目（物の ID を含む）と事務所の既定値だけの設定を断る。この世帯で並べる時点は、候補の鍵と
//   決まった年だけを受ける（物の ID の入る所が無い）
// - 知らない id・案を出せない設定（世帯ごと・読むだけ）・選べない値・形の違う値は、理由と近い候補を添えて断る（接続口の「知らない引数を断る」
//   〔crates/lifeplan/src/args.rs〕と同じ書き方: 書いた物を挙げ、近い物を「〜のことですか」で添える）。黙って直したり捨てたりしない
// - 基本生活費の内訳の並べ方の行の名前は、人の文章が入る所なので、制御文字・書式の文字（見えない文字）を通さず、20文字（LIVING_LABEL_MAX）まで
import { closestOf } from "./closest.ts";
import { ALWAYS_SHOWN, readItemChoice } from "../workspace/input/itemChoice.ts";
import { STAGE_ORDER } from "../workspace/input/stageOrder.ts";
import { LIVING_LABEL_MAX, LIVING_PARTS_MAX, LIVING_PARTS_MIN, readLivingLayout, STANDARD_LIVING_LAYOUT, STANDARD_LIVING_NAMES } from "../workspace/office/livingLayout.ts";
import { readBsGuide } from "../workspace/balanceTab.ts";
import { buildDisplayCatalog, GUIDE_BASIS_CHOICES, HOUSEHOLD_PROPOSABLE_DISPLAY_IDS, PROPOSABLE_DISPLAY_IDS, type DisplayCatalog, type DisplaySetting, type HouseholdProposableDisplayId, type ProposableDisplayId } from "./displayCatalog.ts";

/** 1回の案で出せる設定の数（案を出せる設定の数と同じ。同じ設定は1回だけ） */
export const MAX_DISPLAY_CHANGES = PROPOSABLE_DISPLAY_IDS.length;
/** 渡された世帯ごとの案で、1回に出せる設定の数 */
export const MAX_HOUSEHOLD_DISPLAY_CHANGES = HOUSEHOLD_PROPOSABLE_DISPLAY_IDS.length;

/** 案の宛先: office＝事務所の既定値・household＝渡された世帯ごと */
export type DisplayTarget = "office" | "household";
/** 値を確かめられる設定（事務所の既定値の案か、世帯ごとの案を出せる設定） */
export type CheckableDisplayId = ProposableDisplayId | HouseholdProposableDisplayId;
/** 並べる時点の決まった年の範囲（画面の readBsColumns と同じ） */
const COLUMN_YEAR = { min: 1900, max: 2300 } as const;
/** AI が書いた理由の長さの上限（文字。プランの候補の理由と同じ） */
export const MAX_DISPLAY_NOTE = 500;

/** 確かめた1件（value は get_display_settings の current.office.value と同じ形） */
export interface DisplayChange {
  id: CheckableDisplayId;
  value: unknown;
  note?: string;
}

export type DisplayValueCheck = { ok: true; value: unknown } | { ok: false; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

let catalog: DisplayCatalog | null = null;
const settingOf = (id: string): DisplaySetting | undefined => (catalog ??= buildDisplayCatalog()).settings.find((s) => s.id === id);

export const isProposableDisplayId = (id: string): id is ProposableDisplayId => (PROPOSABLE_DISPLAY_IDS as readonly string[]).includes(id);
export { closestOf } from "./closest.ts";
export const isHouseholdProposableDisplayId = (id: string): id is HouseholdProposableDisplayId => (HOUSEHOLD_PROPOSABLE_DISPLAY_IDS as readonly string[]).includes(id);

// ---- 近い候補: closest.ts（接続口の args.rs の closest と同じ決まり。Web のヒアリングの選び方の確かめ〔0222〕と共有） ----

// ---- 値の確かめ ----

const show = (v: unknown): string => (typeof v === "string" ? `「${v}」` : JSON.stringify(v) ?? String(v));

/** 選べる値の言葉 */
const choiceLabel = (s: DisplaySetting, v: unknown): string => s.choices?.find((c) => c.value === v)?.label ?? String(v);

/** 選べない値の理由（近い値と、その画面の言葉を添える） */
function unknownChoice(s: DisplaySetting, v: unknown, what = "選べる値"): string {
  const values = (s.choices ?? []).map((c) => String(c.value));
  const near = typeof v === "string" ? closestOf(v, values) : null;
  return `${show(v)}は${what}にありません${near !== null ? `（${near}「${choiceLabel(s, near)}」のことですか）` : ""}。選べる値は get_display_settings の choices の value です`;
}

/** 物の中の知らない名前の理由（近い名前を添え、書ける名前を並べる） */
function unknownKeys(o: Record<string, unknown>, allowed: readonly string[], where: string): string | null {
  const bad = Object.keys(o).filter((k) => !allowed.includes(k));
  if (bad.length === 0) return null;
  const parts = bad.map((k) => {
    const c = closestOf(k, allowed);
    return c !== null ? `${k}（${c} のことですか）` : k;
  });
  return `${where}に知らない名前があります: ${parts.join("・")}。書ける名前: ${allowed.join("・")}`;
}

/** 選んだ物の並び（kinds）: 選べる値の中から重ならずに。並びは選べる値の順にそろえる */
function checkKinds(s: DisplaySetting, v: unknown): DisplayValueCheck {
  if (!Array.isArray(v)) return { ok: false, message: "値は選べる値（choices の value）の並びで書いてください" };
  const values = (s.choices ?? []).map((c) => c.value);
  for (const x of v) if (!values.includes(x as never)) return { ok: false, message: unknownChoice(s, x) };
  const dup = v.find((x, i) => v.indexOf(x) !== i);
  if (dup !== undefined) return { ok: false, message: `${show(dup)}が2回あります（同じ値は1回だけ書いてください）` };
  if (s.min !== undefined && v.length < s.min) return { ok: false, message: v.length === 0 ? `空の並びは選べません（${s.min}つ以上。${s.note ?? ""}）` : `${s.min}つ以上を選んでください` };
  if (s.max !== undefined && v.length > s.max) return { ok: false, message: `${s.max}つまでです` };
  return { ok: true, value: values.filter((x) => v.includes(x)) };
}

/** 全部の並べ替え（order）: 選べる値を全部、1回ずつ */
function checkOrder(s: DisplaySetting, v: unknown): DisplayValueCheck {
  if (!Array.isArray(v)) return { ok: false, message: "値は選べる値（choices の value）を全部並べた並びで書いてください" };
  const values = (s.choices ?? []).map((c) => String(c.value));
  for (const x of v) if (typeof x !== "string" || !values.includes(x)) return { ok: false, message: unknownChoice(s, x) };
  const dup = v.find((x, i) => v.indexOf(x) !== i);
  if (dup !== undefined) return { ok: false, message: `${show(dup)}が2回あります（どの入力項目も1回ずつ並べてください）` };
  const missing = values.filter((x) => !v.includes(x));
  if (missing.length > 0) return { ok: false, message: `全部の入力項目を並べてください（足りない: ${missing.map((m) => `${m}「${choiceLabel(s, m)}」`).join("・")}）。並べ替えるだけで、出す・出さないは input.items で決めます` };
  return { ok: true, value: [...v] };
}

/** 1つ選ぶ（choice） */
function checkChoice(s: DisplaySetting, v: unknown): DisplayValueCheck {
  const values = (s.choices ?? []).map((c) => c.value);
  if (!values.includes(v as never)) return { ok: false, message: unknownChoice(s, v) };
  return { ok: true, value: v };
}

/** 新しい世帯で出す入力項目と、開いたときの入れ方（itemChoice）: { hidden: [入力項目], levels: { 入力項目: "detail" | "simple" } } */
function checkItemChoice(s: DisplaySetting, v: unknown): DisplayValueCheck {
  if (!isObj(v)) return { ok: false, message: "値は { hidden: [出さない入力項目], levels: { 入力項目: \"detail\" } } の形で書いてください" };
  const keys = unknownKeys(v, ["hidden", "levels"], "値");
  if (keys !== null) return { ok: false, message: keys };
  const ids = STAGE_ORDER.map((x) => x.id as string);
  const hidden = v.hidden ?? [];
  if (!Array.isArray(hidden)) return { ok: false, message: "hidden は出さない入力項目の並びで書いてください" };
  for (const x of hidden) {
    if (typeof x !== "string" || !ids.includes(x)) return { ok: false, message: `hidden の${unknownChoice(s, x, "入力項目")}` };
    if ((ALWAYS_SHOWN as readonly string[]).includes(x)) return { ok: false, message: `hidden の${show(x)}「${choiceLabel(s, x)}」はいつも出します（外せません）` };
  }
  const dup = hidden.find((x, i) => hidden.indexOf(x) !== i);
  if (dup !== undefined) return { ok: false, message: `hidden に${show(dup)}が2回あります` };
  const levels = v.levels ?? {};
  if (!isObj(levels)) return { ok: false, message: "levels は { 入力項目: \"detail\" } の形で書いてください（\"simple\" は書かなくても標準です）" };
  for (const [k, l] of Object.entries(levels)) {
    if (!ids.includes(k)) return { ok: false, message: `levels の${unknownChoice(s, k, "入力項目")}` };
    if (l !== "detail" && l !== "simple") return { ok: false, message: `levels の ${k} の値${show(l)}は選べません（"detail"＝詳細・"simple"＝標準）` };
  }
  const c = readItemChoice({ hidden, levels });
  return { ok: true, value: { hidden: [...(c.hidden ?? [])], levels: { ...(c.levels ?? {}) } } };
}

/** 人の文章が入る行の名前か（制御文字・書式の文字・行の区切りを含まない、前後の空白を除いて1〜20文字） */
function labelProblem(where: string, v: unknown, required: boolean): string | null {
  if (v === undefined && !required) return null;
  if (typeof v !== "string") return `${where}は文字で書いてください`;
  if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(v)) return `${where}に、改行・タブなどの制御文字や見えない書式の文字は使えません`;
  const t = v.trim();
  if (t === "") return `${where}が空です`;
  if (t.length > LIVING_LABEL_MAX) return `${where}「${t}」は${t.length}文字です（${LIVING_LABEL_MAX}文字まで）`;
  return null;
}

/** 基本生活費の内訳の並べ方（livingLayout）: { rows: [行] }。行は one・group・split（get_display_settings の shape.rowKinds） */
function checkLiving(s: DisplaySetting, v: unknown): DisplayValueCheck {
  if (!isObj(v)) return { ok: false, message: "値は { rows: [行] } の形で書いてください" };
  const top = unknownKeys(v, ["rows"], "値");
  if (top !== null) return { ok: false, message: top };
  if (!Array.isArray(v.rows)) return { ok: false, message: "rows は行の並びで書いてください" };
  const cats = Object.keys(STANDARD_LIVING_NAMES);
  const used = new Set<string>();
  const catProblem = (where: string, c: unknown): string | null => {
    if (typeof c !== "string" || !cats.includes(c)) return `${where}の${unknownChoice(s, c, "内訳")}`;
    if (used.has(c)) return `${where}の${show(c)}「${choiceLabel(s, c)}」は、ほかの行にもあります（内訳は1つの行にだけ入れます）`;
    used.add(c);
    return null;
  };
  for (const [i, r] of v.rows.entries()) {
    const at = `rows[${i}]`;
    if (!isObj(r)) return { ok: false, message: `${at} は行の形（{kind, …}）で書いてください` };
    const kinds = ["one", "group", "split"];
    if (typeof r.kind !== "string" || !kinds.includes(r.kind)) {
      const near = typeof r.kind === "string" ? closestOf(r.kind, kinds) : null;
      return { ok: false, message: `${at}.kind ${show(r.kind)}は行の種類にありません${near !== null ? `（${near} のことですか）` : ""}。行の種類: one（1つの内訳）・group（まとめた行）・split（分けた行）` };
    }
    if (r.kind === "one") {
      const p = unknownKeys(r, ["kind", "category", "label"], at) ?? catProblem(at, r.category) ?? labelProblem(`${at}.label`, r.label, false);
      if (p !== null) return { ok: false, message: p };
    } else if (r.kind === "group") {
      const p = unknownKeys(r, ["kind", "label", "categories"], at) ?? labelProblem(`${at}.label`, r.label, true);
      if (p !== null) return { ok: false, message: p };
      if (!Array.isArray(r.categories) || r.categories.length < 2) return { ok: false, message: `${at}.categories は、まとめる内訳を2つ以上並べてください（1つだけなら kind: "one"）` };
      for (const c of r.categories) {
        const q = catProblem(`${at}.categories`, c);
        if (q !== null) return { ok: false, message: q };
      }
    } else {
      const p = unknownKeys(r, ["kind", "category", "label", "parts"], at) ?? catProblem(at, r.category) ?? labelProblem(`${at}.label`, r.label, false);
      if (p !== null) return { ok: false, message: p };
      if (r.category === "other") return { ok: false, message: `${at}: その他（other）は分けられません（隠した内訳を入れる行のため）` };
      if (!Array.isArray(r.parts) || r.parts.length < LIVING_PARTS_MIN || r.parts.length > LIVING_PARTS_MAX) return { ok: false, message: `${at}.parts は、分けた行を${LIVING_PARTS_MIN}〜${LIVING_PARTS_MAX}つ並べてください` };
      const names: string[] = [];
      for (const [j, part] of r.parts.entries()) {
        const pat = `${at}.parts[${j}]`;
        if (!isObj(part)) return { ok: false, message: `${pat} は {label, share?} の形で書いてください` };
        const q = unknownKeys(part, ["label", "share"], pat) ?? labelProblem(`${pat}.label`, part.label, true);
        if (q !== null) return { ok: false, message: q };
        const name = (part.label as string).trim();
        if (names.includes(name)) return { ok: false, message: `${pat}.label「${name}」は同じ行の中で2回あります` };
        names.push(name);
        if (part.share !== undefined && !(typeof part.share === "number" && Number.isInteger(part.share) && part.share >= 0 && part.share <= 100)) return { ok: false, message: `${pat}.share は0〜100の整数（%）で書いてください` };
      }
      const shares = r.parts.map((x) => (x as Record<string, unknown>).share);
      const some = shares.filter((x) => x !== undefined).length;
      if (some > 0 && some < shares.length) return { ok: false, message: `${at}.parts の share は、どの行にも書くか、どの行にも書かないか（等分）にしてください` };
      if (some > 0 && (shares as number[]).reduce((a, b) => a + b, 0) !== 100) return { ok: false, message: `${at}.parts の share の合計が100になりません` };
    }
  }
  if (!used.has("other")) return { ok: false, message: "その他（other）は隠せません。どこかの行に入れてください（どの行にも無い内訳は、その他の行に入ります）" };
  return { ok: true, value: readLivingLayout(v) ?? STANDARD_LIVING_LAYOUT };
}

/** 出す・出さない（boolean）: true か false だけ（文字の "true" などは受けない） */
function checkBoolean(s: DisplaySetting, v: unknown): DisplayValueCheck {
  if (typeof v !== "boolean") return { ok: false, message: `${show(v)}は選べません。true（${choiceLabel(s, true)}）か false（${choiceLabel(s, false)}）で書いてください` };
  return { ok: true, value: v };
}

/** 整数（integer）: 選べる値があればその中から（「○歳時点」の年齢）、無ければ min〜max の整数 */
function checkInteger(s: DisplaySetting, v: unknown): DisplayValueCheck {
  if (typeof v !== "number" || !Number.isInteger(v)) return { ok: false, message: `${show(v)}は整数ではありません（数で書いてください。文字の "${String(v)}" は受けません）` };
  if (s.choices !== undefined) {
    if (!s.choices.some((c) => c.value === v)) return { ok: false, message: `${v}は選べる値にありません。選べる値: ${s.choices.map((c) => String(c.value)).join("・")}` };
    return { ok: true, value: v };
  }
  if ((s.min !== undefined && v < s.min) || (s.max !== undefined && v > s.max)) return { ok: false, message: `${v}は範囲の外です（${s.min ?? ""}〜${s.max ?? ""}の整数）` };
  return { ok: true, value: v };
}

/** 家計の体力の目安の幅（guide）: { basis?, months: [下限, 上限], risk: [下限, 上限], debt }（get_display_settings の shape） */
function checkGuide(s: DisplaySetting, v: unknown): DisplayValueCheck {
  if (!isObj(v)) return { ok: false, message: "値は { months: [下限, 上限], risk: [下限, 上限], debt: 上限, basis?: \"living\" | \"livingLoan\" } の形で書いてください" };
  const keys = unknownKeys(v, ["basis", "months", "risk", "debt"], "値");
  if (keys !== null) return { ok: false, message: keys };
  const shape = (s.shape ?? {}) as Record<string, { label?: string; min?: number; max?: number }>;
  const pair = (k: "months" | "risk"): string | null => {
    const x = v[k];
    const lo = shape[k]?.min ?? 0;
    const hi = shape[k]?.max ?? 100;
    const label = shape[k]?.label ?? k;
    if (!Array.isArray(x) || x.length !== 2 || !x.every((n) => typeof n === "number" && Number.isFinite(n))) return `${k}（${label}）は [下限, 上限] の2つの数で書いてください`;
    const [a, b] = x as [number, number];
    if (a < lo || b > hi) return `${k}（${label}）の${show(x)}は範囲の外です（${lo}〜${hi}）`;
    if (!(b > a)) return `${k}（${label}）の上限は下限より大きくしてください（${show(x)}）`;
    return null;
  };
  const p = pair("months") ?? pair("risk");
  if (p !== null) return { ok: false, message: p };
  const dmin = shape.debt?.min ?? 1;
  const dmax = shape.debt?.max ?? 100;
  if (typeof v.debt !== "number" || !Number.isFinite(v.debt) || v.debt < dmin || v.debt > dmax) return { ok: false, message: `debt（${shape.debt?.label ?? "負債の重さ"}）は${dmin}〜${dmax}の数で書いてください（${show(v.debt)}）` };
  const bases = GUIDE_BASIS_CHOICES.map((c) => c.value as string);
  if (v.basis !== undefined && v.basis !== null && (typeof v.basis !== "string" || !bases.includes(v.basis))) {
    const near = typeof v.basis === "string" ? closestOf(v.basis, bases) : null;
    return { ok: false, message: `basis ${show(v.basis)}は選べません${near !== null ? `（${near} のことですか）` : ""}。選べる値: ${GUIDE_BASIS_CHOICES.map((c) => `${c.value}「${c.label}」`).join("・")}（書かなければ世帯から決める）` };
  }
  const g = readBsGuide({ months: v.months, risk: v.risk, debt: v.debt, ...(typeof v.basis === "string" ? { basis: v.basis } : {}) });
  return { ok: true, value: g };
}

/**
 * この世帯で並べる時点（columns）: null（「時点を並べる」の既定のまま）か、{point: 候補の鍵} か {year: 決まった年} を2〜4つ、重ならずに。
 * 物の ID・文章の入る所は無い（知らない名前は断る）
 */
function checkColumns(s: DisplaySetting, v: unknown): DisplayValueCheck {
  if (v === null) return { ok: true, value: null };
  if (!Array.isArray(v)) return { ok: false, message: "値は null（「時点を並べる」の既定のまま）か、[{ point: 候補の鍵 } か { year: 決まった年 }] の並びで書いてください" };
  const min = s.min ?? 2;
  const max = s.max ?? 4;
  if (v.length < min || v.length > max) return { ok: false, message: `時点は${min}〜${max}つ並べてください（${v.length}つ）` };
  const points = (s.choices ?? []).map((c) => String(c.value));
  const out: ({ point: string } | { year: number })[] = [];
  for (const [i, x] of v.entries()) {
    const at = `[${i}]`;
    if (!isObj(x)) return { ok: false, message: `${at} は { point: 候補の鍵 } か { year: 決まった年 } の形で書いてください` };
    const keys = unknownKeys(x, ["point", "year"], at);
    if (keys !== null) return { ok: false, message: keys };
    if ("point" in x === "year" in x) return { ok: false, message: `${at} は point か year のどちらか1つだけを書いてください` };
    if ("point" in x) {
      if (typeof x.point !== "string" || !points.includes(x.point)) return { ok: false, message: `${at}.point の${unknownChoice(s, x.point, "候補の時点")}` };
      out.push({ point: x.point });
    } else {
      if (typeof x.year !== "number" || !Number.isInteger(x.year) || x.year < COLUMN_YEAR.min || x.year > COLUMN_YEAR.max) return { ok: false, message: `${at}.year は${COLUMN_YEAR.min}〜${COLUMN_YEAR.max}の整数（西暦の年）で書いてください（${show(x.year)}）` };
      out.push({ year: x.year });
    }
  }
  const keyOf = (c: { point: string } | { year: number }) => ("point" in c ? `p:${c.point}` : `y:${c.year}`);
  const dup = out.find((c, i) => out.findIndex((d) => keyOf(d) === keyOf(c)) !== i);
  if (dup !== undefined) return { ok: false, message: `${show(dup)}が2回あります（同じ時点は1回だけ並べてください）` };
  return { ok: true, value: out };
}

/** 案を出せる設定の1つの値を確かめ、今の値と同じ形にそろえる（理由は設定の id と名前を付けずに返す） */
export function checkDisplayValue(id: CheckableDisplayId, v: unknown): DisplayValueCheck {
  const s = settingOf(id);
  if (s === undefined) return { ok: false, message: "一覧にない設定です" };
  switch (s.type) {
    case "kinds":
      return checkKinds(s, v);
    case "order":
      return checkOrder(s, v);
    case "choice":
      return checkChoice(s, v);
    case "itemChoice":
      return checkItemChoice(s, v);
    case "livingLayout":
      return checkLiving(s, v);
    case "boolean":
      return checkBoolean(s, v);
    case "integer":
      return checkInteger(s, v);
    case "guide":
      return checkGuide(s, v);
    case "columns":
      return checkColumns(s, v);
    default:
      return { ok: false, message: "この形の値は、この道具では受けません" };
  }
}

/** 案を出せない設定の理由（target は案の宛先） */
function notProposable(s: DisplaySetting, target: DisplayTarget): string {
  if (s.readOnly === true) return "読むだけの設定です（アプリの画面で FP が変えます）";
  if (s.id === "result.addedItems") return `${target === "office" ? "世帯だけの設定です（事務所の既定にはしません）。" : ""}鍵に物の ID（渡された世帯では共有ごとの仮の ID）が入るので、案を出せません。FP がアプリの「${s.change.household ?? "その画面"}」で変えます`;
  if (target === "office" && s.scope === "household") return `世帯だけの設定です（事務所の既定にはしません）。share_id に渡された世帯を書くと、その世帯ごとの案を出せます（FP はアプリの「${s.change.household ?? "その画面"}」で変えます）`;
  if (target === "household" && s.scope === "office") return "事務所の既定値だけの設定です（世帯ごとの値はありません）。share_id を書かずに出すと、事務所の既定値の案になります";
  return "この道具では案を出せません";
}

/**
 * 案の全体（changes の並び）を確かめる。problems が空なら changes を案として出せる（値はそろえた後、理由は前後の空白を外した物）。
 * problems は「<id>（<名前>）: <理由>」の文の並び。target は案の宛先（既定は事務所の既定値。household は渡された世帯ごとの案）
 */
export function checkDisplayChanges(changes: unknown, target: DisplayTarget = "office"): { changes: DisplayChange[]; problems: string[] } {
  const problems: string[] = [];
  const out: DisplayChange[] = [];
  const allowed: readonly string[] = target === "household" ? HOUSEHOLD_PROPOSABLE_DISPLAY_IDS : PROPOSABLE_DISPLAY_IDS;
  const max = allowed.length;
  const which = target === "household" ? "渡された世帯ごとの案を出せるのは" : "案を出せるのは";
  if (!Array.isArray(changes) || changes.length === 0) return { changes: [], problems: [`changes に、変える設定を1件以上書いてください（${which} ${allowed.join("・")}）`] };
  if (changes.length > max) problems.push(`changes は${max}件までです（同じ設定は1回だけ）`);
  const all = (catalog ??= buildDisplayCatalog()).settings.map((s) => s.id);
  const seen = new Set<string>();
  for (const [i, c] of changes.entries()) {
    if (!isObj(c) || typeof c.id !== "string") {
      problems.push(`changes[${i}] は { id, value, note? } の形で書いてください`);
      continue;
    }
    const id = c.id.trim();
    const s = settingOf(id);
    if (s === undefined) {
      const near = closestOf(id, all);
      problems.push(`知らない設定の id です: ${id}${near !== null ? `（${near} のことですか）` : ""}。${which} ${allowed.join("・")} です`);
      continue;
    }
    if (!allowed.includes(id)) {
      problems.push(`${id}（${s.label}）: ${notProposable(s, target)}。${which} ${allowed.join("・")} です`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`${id}（${s.label}）: 同じ設定が2回あります（1つの設定には1つの案）`);
      continue;
    }
    seen.add(id);
    if (!("value" in c)) {
      problems.push(`${id}（${s.label}）: value がありません`);
      continue;
    }
    const r = checkDisplayValue(id as CheckableDisplayId, c.value);
    if (!r.ok) {
      problems.push(`${id}（${s.label}）: ${r.message}`);
      continue;
    }
    const note = typeof c.note === "string" ? c.note.trim() : "";
    if (c.note !== undefined && c.note !== null && typeof c.note !== "string") problems.push(`${id}（${s.label}）: note は文字で書いてください`);
    else if (note.length > MAX_DISPLAY_NOTE) problems.push(`${id}（${s.label}）: note は${MAX_DISPLAY_NOTE}文字までです`);
    out.push({ id: id as CheckableDisplayId, value: r.value, ...(note !== "" ? { note } : {}) });
  }
  return { changes: problems.length === 0 ? out : [], problems };
}

/** 接続口の入口（plan.js の displayCheck）: changes の JSON と宛先（"household" は渡された世帯ごとの案。ほかは事務所の既定値）→ `{ changes, problems }` の JSON の文字 */
export function displayCheck(changesJson: string, target: string, _c: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(changesJson);
  } catch {
    return JSON.stringify({ changes: [], problems: ["changes を読めませんでした"] });
  }
  return JSON.stringify(checkDisplayChanges(parsed, target === "household" ? "household" : "office"));
}

