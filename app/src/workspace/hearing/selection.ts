// Web のヒアリング（0125・0192）の選び方の純な部品: ひな形（シンプル・詳細・見直し）・元のシート・聞く項目の数・独自の質問のキー・頼む書類。
// FP の画面（web.ts・WebBuilder.tsx）と、AI接続口の同梱の JS（app/src/connector/hearing.ts。0222）の両方が使う。
// 画面の部品（preact）・本体の命令・世帯の作業の層・Excel の部品を読まない（接続口の固めた実行環境でも動くように）
import type { SheetDefinition } from "../../../../hearing/src/definition.ts";
import { OFFICIAL_SHEETS } from "../../../../hearing/src/sheets.ts";
import { DOCUMENT_TEMPLATES, OWNER_LABEL, templateOf, type DocumentOwner } from "../../../../hearing/src/web/documents.ts";
import { CONSULT_KEY, CUSTOM_PREFIX, selectionFromSheet, type RequestedDocument, type WebSelection } from "../../../../hearing/src/web/packet.ts";

/** ひな形（0192）: シンプル（basic）・詳細（full）・見直し（full で今の値を確かめてもらう）。自分で選んだ・保存した組み合わせは「カスタム」 */
export type WebTemplateKind = "simple" | "detail" | "review";

export const WEB_TEMPLATES: readonly { value: WebTemplateKind; label: string; note: string }[] = [
  { value: "simple", label: "シンプル", note: "ご家族・収入・住まい・貯蓄・生活費を大まかに。金額は範囲でも答えられます" },
  { value: "detail", label: "詳細", note: "書類を見ながら答えてもらう詳しい問い" },
  { value: "review", label: "見直し", note: "詳細の問いで、今の値を見せて確かめてもらう" },
];

/** 自分で選んだ・保存した組み合わせの呼び名 */
export const CUSTOM_TEMPLATE = "カスタム";

export function baseSheet(kind: WebTemplateKind): SheetDefinition {
  const id = kind === "simple" ? "basic" : "full";
  const d = OFFICIAL_SHEETS.filter((x) => x.sheetId === id && x.status !== "retired").sort((a, b) => b.version - a.version)[0];
  if (d === undefined) throw new Error("E_HEARING_NO_SHEET");
  return d;
}

export function sheetOf(sel: WebSelection): SheetDefinition | undefined {
  return OFFICIAL_SHEETS.find((d) => d.sheetId === sel.base.sheetId && d.version === sel.base.version);
}

/** シンプルで既定で外す区画（ご両親。FP が足せば聞ける。0192） */
export const SIMPLE_OFF_SECTIONS: ReadonlySet<string> = new Set(["parents"]);

/**
 * 聞く項目の数（0192。FP の画面の見出し・ひな形の説明・依頼の一覧で同じ数）。金額の「だいたいの範囲」は元の金額の項目の答え方なので数えない。
 * 独自の質問は数える
 */
export function selectedCount(sel: WebSelection): number {
  const def = sheetOf(sel);
  const range = new Set((def?.items ?? []).filter((i) => i.rangeOf !== undefined).map((i) => i.key));
  return sel.sections.reduce((n, s) => n + s.items.filter((i) => !range.has(i.key)).length, 0);
}

/** 独自の質問の新しいキー（ext.office.q + 8字の乱数） */
export function newCustomKey(random: Uint8Array = crypto.getRandomValues(new Uint8Array(6))): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[(random[i % random.length] as number + i * 7) % chars.length];
  return `${CUSTOM_PREFIX}q${s}`;
}

/** 次の書類の ID（d1・d2 …） */
export function nextDocId(sel: WebSelection): string {
  let n = 1;
  while (sel.documents.some((d) => d.id === `d${n}`)) n++;
  return `d${n}`;
}

/** 持ち主の言葉（「ご本人」「配偶者」「配偶者の方」、または self・spouse）→ 持ち主（0190）。分からなければ undefined */
export function ownerFrom(whose: string | null | undefined): DocumentOwner | undefined {
  if (whose === "self" || whose === "ご本人") return "self";
  if (whose === "spouse" || whose === "配偶者" || whose === "配偶者の方") return "spouse";
  return undefined;
}

/** 書類の持ち主を変える（見出しの括弧「（ご本人）」も付け替える。FP の画面・受け取った書類の一覧で、どなたの書類か分かるように） */
export function withOwner(doc: RequestedDocument, owner: DocumentOwner | undefined): RequestedDocument {
  const tags = Object.values(OWNER_LABEL).map((l) => `（${l}）`);
  const tag = tags.find((x) => doc.title.endsWith(x));
  const base = tag === undefined ? doc.title : doc.title.slice(0, -tag.length);
  const { owner: _o, ...rest } = doc;
  void _o;
  return owner === undefined ? { ...rest, title: base } : { ...rest, title: base === "" ? base : `${base}（${OWNER_LABEL[owner]}）`, owner };
}

/** 一覧から足すときの持ち主の初めの値: 人の書類はご本人（同じ書類をもうご本人の分で頼んでいれば配偶者の方）。ほかは選ばない */
export function defaultOwner(sel: WebSelection, kind: string): DocumentOwner | undefined {
  if (templateOf(kind)?.whose !== "person") return undefined;
  return sel.documents.some((d) => d.kind === kind && d.owner === "self") && !sel.documents.some((d) => d.kind === kind && d.owner === "spouse") ? "spouse" : "self";
}

/** 公式の書類のひな形から頼む書類を作る（owner は持ち主。「ご本人」などの言葉でもよい） */
export function documentFromTemplate(sel: WebSelection, kind: string, owner?: string): RequestedDocument {
  const t = DOCUMENT_TEMPLATES.find((x) => x.kind === kind);
  return withOwner({ id: nextDocId(sel), kind, title: t?.title ?? kind, purpose: t?.purpose ?? "", where: t?.where ?? "" }, ownerFrom(owner));
}

/**
 * どのひな形でも既定で外す項目（0192 の追記 2026-11-17）: これからの予定（FP が具体的な項目を選んで聞く。カスタムで選べば聞ける）と、
 * ご相談したいこと（なぜライフプランを作るかは FP が先に説明する。お客さまの画面にも出さない）
 */
export const TEMPLATE_OFF_ITEMS: ReadonlySet<string> = new Set(["hs.plan.events", CONSULT_KEY]);

/** FP の画面の項目の一覧に出さない項目（ご相談したいことは、お客さまの画面に出さないので選べなくした。前の依頼の答えは読む） */
export const HIDDEN_ITEMS: ReadonlySet<string> = new Set([CONSULT_KEY]);

/**
 * ひな形から始める選び方（世帯に依らない部品）。見直しは、has（今の世帯に値のある項目か）が true の項目を「確かめてもらう」に。
 * シンプルはご両親を外す。どれも TEMPLATE_OFF_ITEMS を外す（0192 の追記 2026-11-17）
 */
export function templateSelectionOf(kind: WebTemplateKind, has: (key: string) => boolean): WebSelection {
  const def = baseSheet(kind);
  const label = WEB_TEMPLATES.find((t) => t.value === kind)?.label ?? kind;
  const s = selectionFromSheet(def, (k) => (kind === "review" && has(k) ? "confirm" : "ask"));
  const sections = s.sections
    .filter((x) => kind !== "simple" || !SIMPLE_OFF_SECTIONS.has(x.id))
    .map((x) => ({ ...x, items: x.items.filter((i) => !TEMPLATE_OFF_ITEMS.has(i.key)) }))
    .filter((x) => x.items.length > 0);
  return { ...s, sections, name: label };
}

// ---- 事務所のひな形（事務所の既定値 0073 の hearingTemplates） ----

export interface HearingTemplate {
  name: string;
  selection: WebSelection;
}

export const TEMPLATE_MAX = 20;

/**
 * 事務所のひな形に保存する選び方（H-115）: 頼む書類から、その世帯の書類待ちの結びつき（docRequest）と持ち主（ご本人など）を外し、書類の種類だけを
 * 残す（書類待ちの欄から足した書類は、見出し・説明を書類の一覧の言葉に戻す）。名前はひな形の名前（カスタム）
 */
export function templateForSave(sel: WebSelection, name: string): WebSelection {
  const documents = sel.documents.map((d) => {
    const t = d.docRequest !== undefined ? templateOf(d.kind) : undefined;
    const { docRequest: _r, ...rest } = withOwner(d, undefined);
    void _r;
    return t === undefined ? rest : { ...rest, title: t.title, purpose: t.purpose, where: t.where };
  });
  return { ...sel, documents, name: `${CUSTOM_TEMPLATE}: ${name}` };
}

export function readHearingTemplates(v: unknown): HearingTemplate[] {
  if (!Array.isArray(v)) return [];
  const out: HearingTemplate[] = [];
  for (const t of v.slice(0, TEMPLATE_MAX)) {
    if (typeof t !== "object" || t === null) continue;
    const o = t as { name?: unknown; selection?: unknown };
    const s = o.selection as WebSelection | undefined;
    if (typeof o.name !== "string" || o.name.trim() === "" || s === undefined || typeof s !== "object" || s === null || typeof s.base?.sheetId !== "string" || !Array.isArray(s.sections) || !Array.isArray(s.custom) || !Array.isArray(s.documents)) continue;
    if (OFFICIAL_SHEETS.find((d) => d.sheetId === s.base.sheetId && d.version === s.base.version) === undefined) continue;
    out.push({ name: o.name.trim().slice(0, 40), selection: s });
  }
  return out;
}
