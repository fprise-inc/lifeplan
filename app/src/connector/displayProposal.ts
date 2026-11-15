// 表示の設定の候補（AI接続口の propose_display_settings。0215）: AI が出した、事務所の既定値の見せ方だけの設定7つの候補の値を、表示の設定の一覧
// （displayCatalog.ts）の選べる値・値の形で確かめ、get_display_settings の今の値（current.office.value）と同じ形にそろえる。
// - 接続口（plan.js の displayCheck。候補をアプリに出す前）と、アプリの承認の画面（workspace/office/displayProposals.ts。反映する前）が同じ関数を使う
// - 知らない id・候補を出せない設定（世帯ごと・読むだけ）・選べない値・形の違う値は、理由と近い候補を添えて断る（接続口の「知らない引数を断る」
//   〔crates/lifeplan/src/args.rs〕と同じ書き方: 書いた物を挙げ、近い物を「〜のことですか」で添える）。黙って直したり捨てたりしない
// - 基本生活費の内訳の並べ方の行の名前は、人の文章が入る所なので、制御文字・書式の文字（見えない文字）を通さず、20文字（LIVING_LABEL_MAX）まで
import { ALWAYS_SHOWN, readItemChoice } from "../workspace/input/itemChoice.ts";
import { STAGE_ORDER } from "../workspace/input/stageOrder.ts";
import { LIVING_LABEL_MAX, LIVING_PARTS_MAX, LIVING_PARTS_MIN, readLivingLayout, STANDARD_LIVING_LAYOUT, STANDARD_LIVING_NAMES } from "../workspace/office/livingLayout.ts";
import { buildDisplayCatalog, PROPOSABLE_DISPLAY_IDS, type DisplayCatalog, type DisplaySetting, type ProposableDisplayId } from "./displayCatalog.ts";

/** 1回の候補で出せる設定の数（候補を出せる設定の数と同じ。同じ設定は1回だけ） */
export const MAX_DISPLAY_CHANGES = PROPOSABLE_DISPLAY_IDS.length;
/** AI が書いた理由の長さの上限（文字。プランの候補の理由と同じ） */
export const MAX_DISPLAY_NOTE = 500;

/** 確かめた1件（value は get_display_settings の current.office.value と同じ形） */
export interface DisplayChange {
  id: ProposableDisplayId;
  value: unknown;
  note?: string;
}

export type DisplayValueCheck = { ok: true; value: unknown } | { ok: false; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

let catalog: DisplayCatalog | null = null;
const settingOf = (id: string): DisplaySetting | undefined => (catalog ??= buildDisplayCatalog()).settings.find((s) => s.id === id);

export const isProposableDisplayId = (id: string): id is ProposableDisplayId => (PROPOSABLE_DISPLAY_IDS as readonly string[]).includes(id);

// ---- 近い候補（接続口の args.rs の closest と同じ決まり: 書き方の違いだけ → 1〜2文字の違い → 名前の一部） ----

const folded = (s: string): string => s.replace(/[_\-\s]/g, "").toLowerCase();

function distance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_v, i) => i);
  for (let i = 0; i < x.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < y.length; j++) cur.push(Math.min((prev[j] ?? 0) + (x[i] === y[j] ? 0 : 1), (prev[j + 1] ?? 0) + 1, (cur[j] ?? 0) + 1));
    prev = cur;
  }
  return prev[y.length] ?? 0;
}

/** 書いた名前に近い、使える名前（見つからなければ null） */
export function closestOf(name: string, allowed: readonly string[]): string | null {
  const f = folded(name);
  if (f === "") return null;
  const same = allowed.find((a) => folded(a) === f);
  if (same !== undefined) return same;
  let best: { d: number; a: string } | null = null;
  for (const a of allowed) {
    const d = distance(folded(a), f);
    if (d <= 2 && d < [...f].length && (best === null || d < best.d)) best = { d, a };
  }
  if (best !== null) return best.a;
  if ([...f].length >= 4) {
    const part = allowed.filter((a) => folded(a).includes(f) || f.includes(folded(a))).sort((a, b) => a.length - b.length);
    return part[0] ?? null;
  }
  return null;
}

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

/** 候補を出せる設定の1つの値を確かめ、今の値と同じ形にそろえる（理由は設定の id と名前を付けずに返す） */
export function checkDisplayValue(id: ProposableDisplayId, v: unknown): DisplayValueCheck {
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
    default:
      return { ok: false, message: "この形の値は、この道具では受けません" };
  }
}

/** 候補を出せない設定の理由 */
function notProposable(s: DisplaySetting): string {
  if (s.readOnly === true) return "読むだけの設定です（アプリの画面で FP が変えます）";
  if (s.scope === "household") return `世帯ごとの設定です。今は候補を出せず、FP がアプリの「${s.change.household ?? "その画面"}」で変えます`;
  return "この道具では候補を出せません";
}

/**
 * 候補の全体（changes の並び）を確かめる。problems が空なら changes を候補として出せる（値はそろえた後、理由は前後の空白を外した物）。
 * problems は「<id>（<名前>）: <理由>」の文の並び
 */
export function checkDisplayChanges(changes: unknown): { changes: DisplayChange[]; problems: string[] } {
  const problems: string[] = [];
  const out: DisplayChange[] = [];
  if (!Array.isArray(changes) || changes.length === 0) return { changes: [], problems: [`changes に、変える設定を1件以上書いてください（候補を出せるのは ${PROPOSABLE_DISPLAY_IDS.join("・")}）`] };
  if (changes.length > MAX_DISPLAY_CHANGES) problems.push(`changes は${MAX_DISPLAY_CHANGES}件までです（同じ設定は1回だけ）`);
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
      problems.push(`知らない設定の id です: ${id}${near !== null ? `（${near} のことですか）` : ""}。候補を出せるのは ${PROPOSABLE_DISPLAY_IDS.join("・")} です`);
      continue;
    }
    if (!isProposableDisplayId(id)) {
      problems.push(`${id}（${s.label}）: ${notProposable(s)}。候補を出せるのは ${PROPOSABLE_DISPLAY_IDS.join("・")} です`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`${id}（${s.label}）: 同じ設定が2回あります（1つの設定には1つの候補）`);
      continue;
    }
    seen.add(id);
    if (!("value" in c)) {
      problems.push(`${id}（${s.label}）: value がありません`);
      continue;
    }
    const r = checkDisplayValue(id, c.value);
    if (!r.ok) {
      problems.push(`${id}（${s.label}）: ${r.message}`);
      continue;
    }
    const note = typeof c.note === "string" ? c.note.trim() : "";
    if (c.note !== undefined && c.note !== null && typeof c.note !== "string") problems.push(`${id}（${s.label}）: note は文字で書いてください`);
    else if (note.length > MAX_DISPLAY_NOTE) problems.push(`${id}（${s.label}）: note は${MAX_DISPLAY_NOTE}文字までです`);
    out.push({ id, value: r.value, ...(note !== "" ? { note } : {}) });
  }
  return { changes: problems.length === 0 ? out : [], problems };
}

/** 接続口の入口（plan.js の displayCheck）: changes の JSON → `{ changes, problems }` の JSON の文字 */
export function displayCheck(changesJson: string, _b: string, _c: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(changesJson);
  } catch {
    return JSON.stringify({ changes: [], problems: ["changes を読めませんでした"] });
  }
  return JSON.stringify(checkDisplayChanges(parsed));
}

