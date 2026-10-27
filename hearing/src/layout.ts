// 配置の決まり。管理欄の位置（形式で固定）と、開発中のシート定義の配置（layout.rows）を項目の並びから作る手順
import type { LayoutRow, SheetDefinition } from "./definition.ts";

/**
 * 1枚目の見える管理欄（0018 の2 の3か所目）。形式の版で固定し、シート定義によらない（どのシート定義で読むかを決める前に読むため）。
 * 値の列 C、見出しの列 B
 */
export const MANAGE_ROWS = { sheet: 3, requestId: 4, customerNo: 5 } as const;
export const MANAGE_LABEL_COL = "B";
export const MANAGE_VALUE_COL = "C";
/** 記入欄のシートの列の見出しの行 */
export const ANSWER_HEADER_ROW = 2;
/** 1枚目の配置の始まり（管理欄の下） */
const INTRO_START = 7;
/** 記入欄の配置の始まり（見出しの下） */
const ANSWER_START = 4;

/** 開発中のシート定義の配置を作る（公開した版の配置は定義に書いてあるものが正） */
export function buildLayoutRows(def: SheetDefinition): LayoutRow[] {
  const rows: LayoutRow[] = [];
  const intro = def.layout.introSheet;
  const ans = def.layout.answerSheet;
  let r = 1;
  rows.push({ sheet: intro, row: r, kind: "title", text: def.intro.title });
  r = INTRO_START;
  rows.push({ sheet: intro, row: r++, kind: "heading", text: "ご相談先" });
  for (const ref of ["name", "purpose", "privacy"]) rows.push({ sheet: intro, row: r++, kind: "office", ref });
  r++;
  rows.push({ sheet: intro, row: r++, kind: "heading", text: "ご記入の前に" });
  for (const n of def.intro.notes) rows.push({ sheet: intro, row: r++, kind: "note", text: n });
  r++;
  rows.push({ sheet: intro, row: r++, kind: "heading", text: "ご用意いただきたい書類" });
  for (const d of def.intro.documents) rows.push({ sheet: intro, row: r++, kind: "document", text: d });
  r++;
  rows.push({ sheet: intro, row: r++, kind: "heading", text: def.intro.consentTitle });
  rows.push({ sheet: intro, row: r++, kind: "lead", text: def.intro.consentLead });
  for (const k of def.intro.consentItems) rows.push({ sheet: intro, row: r++, kind: "item", key: k });

  r = 1;
  rows.push({ sheet: ans, row: r, kind: "title", text: def.title });
  r = ANSWER_START;
  const axes = new Map(def.axes.map((a) => [a.id, a]));
  const live = new Set(def.items.filter((i) => i.retiredIn === null).map((i) => i.key));
  for (const s of def.sections) {
    rows.push({ sheet: ans, row: r++, kind: "section", section: s.id });
    if (s.lead !== undefined) rows.push({ sheet: ans, row: r++, kind: "lead", text: s.lead });
    for (const g of s.groups) {
      const keys = g.items.filter((k) => live.has(k));
      const axis = g.axis === undefined ? undefined : axes.get(g.axis);
      if (axis === undefined) {
        if (g.title !== undefined) rows.push({ sheet: ans, row: r++, kind: "group", section: s.id, group: g.id });
        for (const k of keys) rows.push({ sheet: ans, row: r++, kind: "item", key: k });
        continue;
      }
      for (let n = 1; n <= axis.count; n++) {
        rows.push({ sheet: ans, row: r++, kind: "group", section: s.id, group: g.id, index: n });
        for (const k of keys) rows.push({ sheet: ans, row: r++, kind: "item", key: k, index: n });
      }
    }
    r++;
  }
  return rows;
}

/** JSON を鍵の順にそろえて文字にする（指紋の計算用） */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/**
 * 配置の指紋（0018 の2・5）: シートIDと版・項目（キー・型・選択肢・範囲の段）・配置を鍵の順にそろえた JSON の SHA-256。
 * 説明文の言い回しだけを直しても変わらないように、表示名・記入例・手引きは含めない
 */
export async function layoutDigest(def: SheetDefinition): Promise<string> {
  const items = def.items.map((i) => ({ key: i.key, type: i.type, unit: i.unit, choices: i.choices?.map((c) => c.value), choiceList: i.choiceList, ranges: i.ranges?.map((r) => [r.from, r.to]), rangeOf: i.rangeOf }));
  const rows = def.layout.rows.map((r) => ({ ...r, text: undefined }));
  const text = canonicalJson({ sheetId: def.sheetId, version: def.version, years: def.years, items, layout: { ...def.layout, rows } });
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
