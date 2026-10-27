// 0018 の1: シート定義（JSON）の型。シート定義を唯一の正とし、Excel の書き出し・取り込みの規則・世帯データとの変換をここから作る。
// 形式は schema/sheet-definition.schema.json（JSON Schema）。公開した版（status: published）のシート定義は書き換えない（新しい版を作る）

/** シート定義の形式名（定義ファイルの format） */
export const DEFINITION_FORMAT = "fprise-lifeplan-hearing-sheet-definition";

/** 入力の型 */
export type ItemType = "yearMonth" | "integer" | "decimal" | "money" | "moneyRange" | "percent" | "choice" | "text";

/**
 * 金額のだいたいの範囲の1段（moneyRange の項目。from・to は項目の単位〔円・万円〕）。from が 0 の段は「〜未満」、to が null の段は「〜以上」。
 * 取り込みでは、範囲の真ん中（上が開いた段は下の端）を推定の値にする（確定にしない）
 */
export interface MoneyRangeStep {
  readonly from: number;
  readonly to: number | null;
  readonly label: string;
}

/** 回答の状態のうち、選択肢で選ぶもの（値も状態も空なら「未回答」。0018 の4） */
export type ChoosableState = "unknown" | "notApplicable";

export interface Choice {
  /** 取り込みで使う値（世帯データの値・構成員の指し方など） */
  readonly value: string;
  /** シートに出す言葉 */
  readonly label: string;
}

/** 金額の単位（シートに表示し、取り込みで円の整数にそろえる。0002） */
export interface MoneyUnit {
  readonly scale: "yen" | "manYen";
  readonly basis: "monthly" | "annual" | "once";
}

export interface SheetItem {
  /** 項目キー（`hs.<分野>.<項目>`。変えない・使い回さない。0004・0018 の3） */
  readonly key: string;
  /** 表示名 */
  readonly label: string;
  readonly type: ItemType;
  readonly unit?: MoneyUnit;
  /** 数・率の単位の表示（人・歳・か月・% など） */
  readonly unitLabel?: string;
  readonly choices?: readonly Choice[];
  /** 選択肢の言葉の一覧の名前（年の一覧など、シートで共通の長い一覧） */
  readonly choiceList?: "years";
  /** 金額の範囲の段（moneyRange のとき） */
  readonly ranges?: readonly MoneyRangeStep[];
  /** この範囲の答えが、どの金額の項目の代わりか（moneyRange のとき。その項目が空のときに範囲で補う） */
  readonly rangeOf?: string;
  readonly min?: number;
  readonly max?: number;
  readonly maxLength?: number;
  /** 記入例 */
  readonly example?: string;
  /** 転記の手引き（書類のどの欄を写すか） */
  readonly guide?: string;
  /** 選べる状態 */
  readonly states: readonly ChoosableState[];
  /** 項目キー → 入力項目ID（0004）の変換表。計算に使わない項目（メモ・同意）は空 */
  readonly inputItems: readonly string[];
  /** 取り込んだ値の行き先が世帯データの外のとき（メモ・同意の記録） */
  readonly destination?: "memo" | "consent";
  /** 追加された版（シートの版） */
  readonly addedIn: number;
  /** 廃止された版（廃止しても定義に残す。0018 の3） */
  readonly retiredIn: number | null;
}

/** 繰り返しの軸（本人と配偶者、子、保険の件数など。キーは1つにし、何番目かを別に持つ。0018 の3） */
export interface Axis {
  readonly id: string;
  readonly count: number;
  /** 何番目かの見出し（count と同じ数） */
  readonly labels: readonly string[];
}

export interface SheetGroup {
  readonly id: string;
  readonly title?: string;
  /** 繰り返しの軸（省略は繰り返さない） */
  readonly axis?: string;
  readonly items: readonly string[];
}

export interface SheetSection {
  readonly id: string;
  readonly title: string;
  readonly lead?: string;
  readonly groups: readonly SheetGroup[];
}

/** 1枚目（はじめに）に出す文 */
export interface Intro {
  readonly title: string;
  /** 注意書き（お名前を書かない・聞かないことなど） */
  readonly notes: readonly string[];
  /** 用意してほしい書類 */
  readonly documents: readonly string[];
  /** 同意の欄の見出しと説明 */
  readonly consentTitle: string;
  readonly consentLead: string;
  /** 同意の欄の項目キー */
  readonly consentItems: readonly string[];
}

/** 配置の1行（シートの名前と行。列は layout.columns で決まる） */
export type LayoutRow =
  | { readonly sheet: string; readonly row: number; readonly kind: "title" | "note" | "document" | "heading" | "lead" | "office"; readonly text?: string; readonly ref?: string }
  | { readonly sheet: string; readonly row: number; readonly kind: "section"; readonly section: string }
  | { readonly sheet: string; readonly row: number; readonly kind: "group"; readonly section: string; readonly group: string; readonly index?: number }
  | { readonly sheet: string; readonly row: number; readonly kind: "item"; readonly key: string; readonly index?: number };

export interface Layout {
  /** 1枚目（はじめに）と記入欄のシートの名前 */
  readonly introSheet: string;
  readonly answerSheet: string;
  /** 列: 番号・質問・記入欄・記入欄2（年月の月、ほかは単位の表示）・状態・記入例と手引き */
  readonly columns: { readonly no: string; readonly label: string; readonly value: string; readonly value2: string; readonly status: string; readonly guide: string };
  readonly rows: readonly LayoutRow[];
}

export interface SheetDefinition {
  readonly $schema?: string;
  readonly format: typeof DEFINITION_FORMAT;
  /** シートID（basic・full・review） */
  readonly sheetId: string;
  /** 版（シート定義ごとの通し番号） */
  readonly version: number;
  /** draft は開発中（書き換えてよい）。published は公開済み（書き換えない）。retired は書き出さないが取り込める */
  readonly status: "draft" | "published" | "retired";
  readonly title: string;
  readonly intro: Intro;
  readonly axes: readonly Axis[];
  readonly items: readonly SheetItem[];
  readonly sections: readonly SheetSection[];
  /** 年の一覧（生年月・契約年月などの年の選択肢）の範囲 */
  readonly years: { readonly from: number; readonly to: number };
  readonly layout: Layout;
}

/** 回答のセルの名前（Excel の名前の定義）。繰り返しは `_n`（0018 の4） */
export function cellName(key: string, index?: number): string {
  return index === undefined ? key : `${key}_${index}`;
}

export function itemByKey(def: SheetDefinition): Map<string, SheetItem> {
  return new Map(def.items.map((i) => [i.key, i]));
}

/** 回答のセルの一覧（配置の item 行） */
export function answerCells(def: SheetDefinition): { key: string; index?: number; sheet: string; row: number }[] {
  const out: { key: string; index?: number; sheet: string; row: number }[] = [];
  for (const r of def.layout.rows) {
    if (r.kind === "item") out.push({ key: r.key, ...(r.index !== undefined ? { index: r.index } : {}), sheet: r.sheet, row: r.row });
  }
  return out;
}

export { colIndex, colLetter } from "../../xlsx/src/cells.ts";

/** 西暦の年の選択肢の言葉（和暦を併記。0018 の4） */
export function yearLabel(y: number): string {
  const era = y >= 2019 ? `令和${y === 2019 ? "元" : y - 2018}年` : y >= 1989 ? `平成${y === 1989 ? "元" : y - 1988}年` : y >= 1926 ? `昭和${y === 1926 ? "元" : y - 1925}年` : `大正${y - 1911}年`;
  return `${y}年（${era}）`;
}

export const MONTH_LABELS: readonly string[] = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);

/** 状態の選択肢の言葉 */
export const STATE_LABELS: Readonly<Record<ChoosableState, string>> = { unknown: "わからない", notApplicable: "該当なし" };

/**
 * シート定義の中身の決まり（JSON Schema で書けない部分）を確かめる。問題の一覧を返す（空なら問題なし）。
 * 取り込みの前と、CI（test/definition.test.ts）で使う
 */
export function checkDefinition(def: SheetDefinition): string[] {
  const errs: string[] = [];
  const items = itemByKey(def);
  if (items.size !== def.items.length) errs.push("項目キーが重なっている");
  const axes = new Map(def.axes.map((a) => [a.id, a]));
  for (const a of def.axes) if (a.labels.length !== a.count) errs.push(`軸 ${a.id} の見出しの数が count と違う`);
  for (const i of def.items) {
    if (!/^(hs|ext)(\.[a-z][a-zA-Z0-9]*)+$/.test(i.key)) errs.push(`項目キーの形が違う: ${i.key}`);
    if (i.type === "choice" && (i.choices === undefined || i.choices.length === 0) && i.choiceList === undefined) errs.push(`選択肢が無い: ${i.key}`);
    if ((i.type === "money" || i.type === "moneyRange") && i.unit === undefined) errs.push(`金額の単位が無い: ${i.key}`);
    if (i.type === "moneyRange") errs.push(...checkRanges(def, i));
    else if (i.ranges !== undefined || i.rangeOf !== undefined) errs.push(`範囲の段は moneyRange の項目だけ: ${i.key}`);
    if (i.type === "choice" && i.choices !== undefined) {
      const labels = new Set(i.choices.map((c) => c.label));
      if (labels.size !== i.choices.length) errs.push(`選択肢の言葉が重なっている: ${i.key}`);
      for (const c of i.choices) if (c.label === STATE_LABELS.unknown || c.label === STATE_LABELS.notApplicable) errs.push(`選択肢に状態の言葉を使っている: ${i.key}`);
    }
  }
  const placed = new Map<string, number>();
  for (const s of def.sections) {
    for (const g of s.groups) {
      if (g.axis !== undefined && !axes.has(g.axis)) errs.push(`知らない軸: ${g.axis}`);
      for (const k of g.items) {
        if (!items.has(k)) errs.push(`定義に無い項目: ${k}`);
        placed.set(k, (placed.get(k) ?? 0) + 1);
      }
    }
  }
  for (const k of def.intro.consentItems) {
    if (!items.has(k)) errs.push(`定義に無い同意の項目: ${k}`);
    placed.set(k, (placed.get(k) ?? 0) + 1);
  }
  for (const i of def.items) {
    if (i.retiredIn !== null) continue;
    const n = placed.get(i.key) ?? 0;
    if (n !== 1) errs.push(`項目がシートに${n === 0 ? "置かれていない" : "2回以上置かれている"}: ${i.key}`);
  }
  // 配置: 同じシートの同じ行に2つ置かない・回答のセルがすべての項目と繰り返しにある
  const seen = new Set<string>();
  for (const r of def.layout.rows) {
    const at = `${r.sheet}!${r.row}`;
    if (seen.has(at)) errs.push(`同じ行に2つ置いている: ${at}`);
    seen.add(at);
    if (r.sheet !== def.layout.introSheet && r.sheet !== def.layout.answerSheet) errs.push(`知らないシート: ${r.sheet}`);
  }
  const cells = new Set(answerCells(def).map((c) => cellName(c.key, c.index)));
  for (const s of def.sections) {
    for (const g of s.groups) {
      const n = g.axis === undefined ? 0 : (axes.get(g.axis)?.count ?? 0);
      for (const k of g.items) {
        if (n === 0) {
          if (!cells.has(k)) errs.push(`回答のセルが無い: ${k}`);
        } else {
          for (let x = 1; x <= n; x++) if (!cells.has(cellName(k, x))) errs.push(`回答のセルが無い: ${cellName(k, x)}`);
        }
      }
    }
  }
  for (const k of def.intro.consentItems) if (!cells.has(k)) errs.push(`回答のセルが無い: ${k}`);
  return errs;
}

/** 金額の範囲の項目の決まり: 段が下から順に隙間なく並び、上が開くのは最後の段だけ。代わりの金額の項目と単位・行き先・軸が同じ */
function checkRanges(def: SheetDefinition, i: SheetItem): string[] {
  const errs: string[] = [];
  const steps = i.ranges ?? [];
  if (steps.length < 2) errs.push(`範囲の段が無い: ${i.key}`);
  steps.forEach((s, n) => {
    if (n === 0 && s.from !== 0) errs.push(`範囲の最初の段は 0 から: ${i.key}`);
    if (n > 0 && s.from !== steps[n - 1]?.to) errs.push(`範囲の段に隙間か重なりがある: ${i.key} の ${s.label}`);
    if (s.to === null ? n !== steps.length - 1 : s.to <= s.from) errs.push(`範囲の段の上の端が違う: ${i.key} の ${s.label}`);
    if (s.label === STATE_LABELS.unknown || s.label === STATE_LABELS.notApplicable) errs.push(`範囲の段に状態の言葉を使っている: ${i.key}`);
  });
  if (new Set(steps.map((s) => s.label)).size !== steps.length) errs.push(`範囲の段の言葉が重なっている: ${i.key}`);
  const base = i.rangeOf === undefined ? undefined : def.items.find((x) => x.key === i.rangeOf);
  if (base === undefined || base.type !== "money") errs.push(`範囲の代わりの金額の項目が無い: ${i.key}`);
  else {
    if (base.unit?.scale !== i.unit?.scale || base.unit?.basis !== i.unit?.basis) errs.push(`範囲の単位が金額の項目と違う: ${i.key}`);
    if (base.destination !== i.destination) errs.push(`範囲の行き先が金額の項目と違う: ${i.key}`);
    if (axisOf(def, base.key)?.id !== axisOf(def, i.key)?.id) errs.push(`範囲の繰り返しの軸が金額の項目と違う: ${i.key}`);
  }
  return errs;
}

/** 範囲の段の取り込みの値（円の整数の「下-上」。上が開いた段は「下-」） */
export function rangeValue(item: SheetItem, s: MoneyRangeStep): string {
  const k = item.unit?.scale === "manYen" ? 10000 : 1;
  return `${Math.round(s.from * k)}-${s.to === null ? "" : Math.round(s.to * k)}`;
}

/** 項目がどの軸で繰り返すか（繰り返さないなら null） */
export function axisOf(def: SheetDefinition, key: string): Axis | null {
  for (const s of def.sections) {
    for (const g of s.groups) {
      if (g.items.includes(key)) return g.axis === undefined ? null : (def.axes.find((a) => a.id === g.axis) ?? null);
    }
  }
  return null;
}
