// AI が Web のヒアリング（0125・0192）の聞く項目を決めるときの、選び方の一覧と確かめ（0222）。
// - hearingOptions: AI に見せる「ヒアリングで聞ける項目」の一覧（票・分野・項目キー・問いの言葉・範囲でも答えられるか・繰り返し・ひな形の既定・
//   頼める書類・独自の質問の形と上限・ご相談したいことの話題・数え方）。渡された世帯があれば、項目ごとに今の値があるか（値そのものは出さない）
// - aiSelection: AI が書いた選び方（ひな形・項目・聞き方・独自の質問・頼む書類・話題・名前）を、FP の画面と同じ部品（selection.ts・packet.ts の
//   checkSelection）で WebSelection にそろえて確かめる。知らない項目・混ぜられない票・上限を超えた物は、近い候補を添えて問題に挙げる（黙って直さない）
// - 接続口（app/src/connector/hearing.ts。plan.js に同梱）が発行・ひな形の案の前に、アプリの画面（aiHearing.ts）が発行の前に、同じ関数で確かめる
// - 画面の部品・本体の命令・世帯の作業の層を読まない（接続口の固めた実行環境でも動くように。乱数も使わない: 独自の質問のキーは並びと文から決める）
import { closestOf } from "../../connector/closest.ts";
import type { SheetDefinition, SheetItem } from "../../../../hearing/src/definition.ts";
import { DOCUMENT_TEMPLATES, OWNER_LABEL, templateOf, type DocumentOwner } from "../../../../hearing/src/web/documents.ts";
import { estimate } from "../../../../hearing/src/web/flow.ts";
import {
  checkSelection,
  CUSTOM_ANSWER_MAX,
  CUSTOM_CHOICE_LABEL_MAX,
  CUSTOM_CHOICES_MAX,
  CUSTOM_HELP_MAX,
  CUSTOM_LABEL_MAX,
  CUSTOM_MAX,
  FP_SECTION,
  packetBody,
  selectableItems,
  type CustomAnswer,
  type CustomQuestion,
  type RequestedDocument,
  type SelectedItem,
  type SelectedSection,
  type WebSelection,
} from "../../../../hearing/src/web/packet.ts";
import { DOCUMENT_LIMITS } from "../../../../hearing/src/web/documents.ts";
import { baseSheet, CUSTOM_TEMPLATE, HIDDEN_ITEMS, selectedCount, sheetOf, SIMPLE_OFF_SECTIONS, TEMPLATE_OFF_ITEMS, templateSelectionOf, WEB_TEMPLATES, withOwner, type WebTemplateKind } from "./selection.ts";

/** AI が呼ぶときの票の名前（FP の画面のひな形の名前にそろえる: シンプル＝簡易の票 basic・詳細＝詳細の票 full） */
export type AiSheet = "simple" | "detail";
export const AI_SHEETS: readonly AiSheet[] = ["simple", "detail"];
/** AI が選べるひな形（見直し・足りない所だけは、渡された世帯があるときだけ） */
export const AI_TEMPLATES = ["simple", "detail", "review", "missing"] as const;
export type AiTemplate = (typeof AI_TEMPLATES)[number];

/** ひな形の名前（依頼の一覧の行に出す）・ひな形の名前の上限 */
export const AI_NAME_MAX = 40;
/** 何のための問いか（お客さまの最初の画面。officeFace の上限と同じ） */
export const AI_PURPOSE_MAX = 120;
/** 書類の見出し・説明の上限（checkSelection と同じ） */
const DOC_TITLE_MAX = 80;
const DOC_TEXT_MAX = 200;

const aiSheetOf = (sheetId: string): AiSheet | null => (sheetId === "basic" ? "simple" : sheetId === "full" ? "detail" : null);
const kindOf = (s: AiSheet): WebTemplateKind => (s === "simple" ? "simple" : "detail");
export const sheetDefOf = (s: AiSheet): SheetDefinition => baseSheet(kindOf(s));

const show = (v: unknown): string => (typeof v === "string" ? `「${v}」` : (JSON.stringify(v) ?? String(v)));
const near = (v: string, list: readonly string[]): string => {
  const c = closestOf(v, list);
  return c !== null ? `（${c} のことですか）` : "";
};

/** 人の書いた文の確かめ（制御文字・見えない書式の文字・行の区切りは使えない。前後の空白を除いて1〜max文字） */
export function textProblem(v: unknown, where: string, max: number, allowEmpty = false): string | null {
  if (typeof v !== "string") return `${where}は文字で書いてください`;
  if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(v)) return `${where}に、改行・タブなどの制御文字や見えない書式の文字は使えません`;
  const t = v.trim();
  if (t === "" && !allowEmpty) return `${where}が空です`;
  const n = [...t].length;
  if (n > max) return `${where}は${max}文字までです（${n}文字）`;
  return null;
}

// ---- 一覧（get_hearing_options） ----

/** 範囲の項目（金額の項目の「だいたいの範囲」）: 金額の項目のキー → 範囲の項目のキー */
function rangeMap(def: SheetDefinition): Map<string, string> {
  return new Map(def.items.filter((i) => i.rangeOf !== undefined).map((i) => [i.rangeOf as string, i.key]));
}

function sectionIdOf(def: SheetDefinition, key: string): string | undefined {
  return def.sections.find((s) => s.groups.some((g) => g.items.includes(key)))?.id;
}

const sectionTitle = (def: SheetDefinition, id: string): string => (id === FP_SECTION.id ? FP_SECTION.title : (def.sections.find((s) => s.id === id)?.title ?? id).replace(/^\d+\.\s*/, ""));

/** 答えの形の言葉（AI が選ぶときの手がかり） */
function itemShape(it: SheetItem): string {
  if (it.type === "money") return `金額（${it.unit?.scale === "manYen" ? "万円" : "円"}${it.unit?.basis === "monthly" ? "・月あたり" : it.unit?.basis === "annual" ? "・1年あたり" : ""}）`;
  if (it.type === "decimal" || it.type === "percent") return `数${it.unitLabel !== undefined ? `（${it.unitLabel}）` : ""}`;
  if (it.type === "choice") return `選択（${(it.choices ?? []).map((c) => c.label).join("・")}）`;
  if (it.type === "yearMonth") return "年月";
  if (it.type === "integer") return `整数${it.unitLabel !== undefined ? `（${it.unitLabel}）` : ""}`;
  if (it.type === "text") return "文";
  return it.type;
}

export interface HearingOptionsArgs {
  /** 返す票（省くと両方） */
  sheet?: AiSheet;
  /** 渡された世帯の、今の値のある項目キー（値そのものは渡さない）。世帯が無ければ null */
  filled?: readonly string[] | null;
  /** 事務所のひな形（アプリが起動していれば。無ければ null） */
  officeTemplates?: readonly { name: string; selection: WebSelection }[] | null;
}

/** 数え方の説明（FP の画面・案内文と同じ） */
export const COUNTING_NOTE =
  "聞く項目の数（selectedCount）は選んだ項目の数です（金額の「だいたいの範囲」は金額の項目の答え方なので数えません。独自の質問は数えます）。お客さまの画面の数と所要時間（estimate）は、お客さまの最初の画面・案内文と同じ数え方で、同意・分岐の問い・問いの画面を、夫婦と子2人・住宅ローン1本・保険2件・ご両親を答えるとして数えます（1画面15秒・書類1通1分ほど）。見直しは前回の値を見せる問いで数えるので、アプリが発行するときに数え直した数が答えに入ります。";

/** AI に見せるヒアリングで聞ける項目の一覧（読むだけ） */
export function hearingOptions(a: HearingOptionsArgs = {}): Record<string, unknown> {
  const filled = a.filled === undefined || a.filled === null ? null : new Set(a.filled);
  const sheets = (a.sheet === undefined ? AI_SHEETS : [a.sheet]).map((s) => {
    const def = sheetDefOf(s);
    const ok = new Set(selectableItems(def).map((i) => i.key));
    const ranges = rangeMap(def);
    const items = new Map(def.items.map((i) => [i.key, i]));
    const sections = def.sections
      .map((sec) => ({
        id: sec.id,
        title: sectionTitle(def, sec.id),
        ...(s === "simple" && SIMPLE_OFF_SECTIONS.has(sec.id) ? { offInTemplate: true } : {}),
        items: sec.groups
          .flatMap((g) => g.items.map((k) => ({ k, axis: g.axis })))
          .filter(({ k }) => ok.has(k) && !HIDDEN_ITEMS.has(k) && items.get(k)?.rangeOf === undefined)
          .map(({ k, axis }) => {
            const it = items.get(k) as SheetItem;
            const axisLabels = axis === undefined ? undefined : def.axes.find((x) => x.id === axis)?.labels;
            return {
              key: k,
              label: it.label,
              shape: itemShape(it),
              ...(ranges.has(k) ? { range: true } : {}),
              ...(axis !== undefined ? { repeat: axis, repeatLabels: axisLabels } : {}),
              ...(TEMPLATE_OFF_ITEMS.has(k) ? { offInTemplate: true } : {}),
              ...(filled !== null ? { filled: filled.has(k) } : {}),
            };
          }),
      }))
      .filter((sec) => sec.items.length > 0);
    return { sheet: s, title: s === "simple" ? "シンプル（簡易の票）" : "詳細（詳細の票）", version: def.version, sections };
  });
  const tmpl = (t: AiTemplate) => {
    const label = t === "missing" ? "足りない所だけ" : (WEB_TEMPLATES.find((w) => w.value === t)?.label ?? t);
    const note =
      t === "simple"
        ? "シンプルの票の全部の項目（ご両親の分野は外す。items に書けば足せる）。金額は範囲でも答えられる"
        : t === "detail"
          ? "詳細の票の全部の項目"
          : t === "review"
            ? "詳細の票の全部の項目で、今の世帯に値のある項目を「確認してもらう」（confirm。今の値を見せる）にする。渡された世帯（share_id）があるときだけ。URL は AI に返さない（アプリでコピー）"
            : "詳細の票の項目のうち、今の世帯に値の無い項目だけを聞く（ask）。渡された世帯（share_id）があるときだけ。check_inputs の一覧と合わせて、ほかの項目を items で足せる";
    const needs = t === "review" || t === "missing";
    let counts: Record<string, unknown> | null = null;
    if (!needs || filled !== null) {
      const sel = aiSelection({ template: t }, { filled: filled === null ? null : [...filled], officeTemplates: null });
      if (sel.selection !== null) counts = { selectedCount: sel.counts?.selectedCount, screens: sel.counts?.screens, minutes: sel.counts?.minutes };
    }
    return { id: t, label, sheet: t === "simple" ? "simple" : "detail", needsShare: needs, note, ...(counts !== null ? counts : {}) };
  };
  const office =
    a.officeTemplates === undefined || a.officeTemplates === null
      ? null
      : a.officeTemplates.map((t) => ({
          name: t.name,
          sheet: aiSheetOf(t.selection.base.sheetId),
          selectedCount: sheetOf(t.selection) === undefined ? null : selectedCount(t.selection),
          documents: t.selection.documents.map((d) => d.kind ?? "other"),
          custom: t.selection.custom.length,
        }));
  return {
    sheets,
    templates: AI_TEMPLATES.map(tmpl),
    officeTemplates: office,
    documents: DOCUMENT_TEMPLATES.map((d) => ({ kind: d.kind, title: d.title, purpose: d.purpose, where: d.where, owner: d.whose === "person" ? "required" : d.whose === "either" ? "optional" : "none", covers: d.covers })),
    custom: { max: CUSTOM_MAX, labelMax: CUSTOM_LABEL_MAX, helpMax: CUSTOM_HELP_MAX, answerMax: CUSTOM_ANSWER_MAX, answers: ["text", "yesNo", "choice"], choicesMax: CUSTOM_CHOICES_MAX, choiceLabelMax: CUSTOM_CHOICE_LABEL_MAX },
    limits: { documents: DOCUMENT_LIMITS.documents, nameMax: AI_NAME_MAX, purposeMax: AI_PURPOSE_MAX, documentTitleMax: DOC_TITLE_MAX, documentTextMax: DOC_TEXT_MAX },
    counting: COUNTING_NOTE,
    ...(filled !== null ? { household: { filled: [...filled].length, note: "filled は今の値があるか（値は返しません）。見直し（confirm）にできるのは filled が true の項目だけです" } } : {}),
  };
}

// ---- 選び方（issue_hearing_url・propose_hearing_template） ----

export interface AiItemArg {
  key: string;
  mode?: "ask" | "confirm";
  range?: boolean;
}
export interface AiCustomArg {
  label: string;
  help?: string;
  answer?: CustomAnswer;
  choices?: string[];
}
export interface AiDocumentArg {
  kind: string;
  owner?: DocumentOwner;
  title?: string;
  purpose?: string;
  where?: string;
}
export interface AiSelectionArgs {
  /** 始めるひな形（simple・detail・review・missing か、事務所のひな形の名前）。省くと sheet の全部（シンプルはご両親を外す） */
  template?: string;
  sheet?: AiSheet;
  /** 聞く項目（書くと、ひな形の項目を置き換える。並びはこの順。分野はその項目の分野で、最初に出た順） */
  items?: AiItemArg[];
  custom?: AiCustomArg[];
  documents?: AiDocumentArg[];
  name?: string;
}

export interface AiSelectionContext {
  /** 渡された世帯の、今の値のある項目キー（世帯が無ければ null） */
  filled: readonly string[] | null;
  officeTemplates: readonly { name: string; selection: WebSelection }[] | null;
}

export interface AiSelectionResult {
  selection: WebSelection | null;
  problems: string[];
  counts: { selectedCount: number; screens: number; minutes: number } | null;
  /** 見直し（今の値を見せて確かめてもらう項目）を含むか（含むなら URL を AI に返さない） */
  review: boolean;
}

const ARG_KEYS = ["template", "sheet", "items", "custom", "documents", "name"] as const;

/** 独自の質問のキー（並びと文から決める。乱数を使わない: 同じ選び方なら同じキー） */
export function aiCustomKey(index: number, label: string): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let h = 2166136261 ^ index;
  for (const ch of label) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619) >>> 0;
  let s = "";
  for (let i = 0; i < 8; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    s += chars[h % chars.length];
  }
  return `ext.office.q${s}`;
}

/** AI が書いた選び方を WebSelection にそろえて確かめる（問題があれば selection は null。黙って直さない） */
export function aiSelection(raw: AiSelectionArgs | Record<string, unknown>, ctx: AiSelectionContext): AiSelectionResult {
  const a = raw as AiSelectionArgs;
  const problems: string[] = [];
  const fail = (): AiSelectionResult => ({ selection: null, problems, counts: null, review: false });
  for (const k of Object.keys(raw)) if (!(ARG_KEYS as readonly string[]).includes(k)) problems.push(`知らない名前です: ${k}${near(k, ARG_KEYS)}。書ける名前: ${ARG_KEYS.join("・")}`);
  if (problems.length > 0) return fail();
  const filled = ctx.filled === null ? null : new Set(ctx.filled);

  // 始めるひな形
  let start: WebSelection | null = null;
  let sheet: AiSheet | null = a.sheet ?? null;
  if (a.sheet !== undefined && !AI_SHEETS.includes(a.sheet)) {
    problems.push(`sheet ${show(a.sheet)}は選べません${near(String(a.sheet), AI_SHEETS)}。simple（シンプル）か detail（詳細）です`);
    return fail();
  }
  const t = a.template;
  if (t !== undefined) {
    const office = ctx.officeTemplates?.find((x) => x.name === t || `${CUSTOM_TEMPLATE}: ${x.name}` === t) ?? null;
    if ((AI_TEMPLATES as readonly string[]).includes(t)) {
      const kind = t as AiTemplate;
      const sh: AiSheet = kind === "simple" ? "simple" : "detail";
      if (sheet !== null && sheet !== sh) {
        problems.push(`template ${show(t)}は${sh === "simple" ? "シンプル" : "詳細"}の票です。sheet ${show(sheet)}とは混ぜられません（シンプルと詳細の項目は1つの依頼に混ぜられません）`);
        return fail();
      }
      sheet = sh;
      if ((kind === "review" || kind === "missing") && filled === null) {
        problems.push(`template ${show(t)}は、渡された世帯（share_id）があるときだけ使えます（今の世帯の値で、確認してもらう項目・聞く項目を決めるため）`);
        return fail();
      }
      if (kind === "missing") {
        const s = templateSelectionOf("detail", () => false);
        // 値のある金額の項目の「だいたいの範囲」も一緒に外す
        const of = new Map(sheetDefOf("detail").items.filter((i) => i.rangeOf !== undefined).map((i) => [i.key, i.rangeOf as string]));
        const has = (k: string) => (filled as Set<string>).has(k) || (filled as Set<string>).has(of.get(k) ?? "");
        start = { ...s, sections: s.sections.map((x) => ({ ...x, items: x.items.filter((i) => !has(i.key)) })).filter((x) => x.items.length > 0), name: "足りない所だけ（詳細から）" };
      } else start = templateSelectionOf(kind === "review" ? "review" : kindOf(sh), (k) => filled?.has(k) === true);
    } else if (office !== null) {
      const sh = aiSheetOf(office.selection.base.sheetId);
      if (sh === null || sheetOf(office.selection) === undefined) {
        problems.push(`事務所のひな形 ${show(t)}は、このアプリの版では読めない票です`);
        return fail();
      }
      if (sheet !== null && sheet !== sh) {
        problems.push(`事務所のひな形 ${show(t)}は${sh === "simple" ? "シンプル" : "詳細"}の票です。sheet ${show(sheet)}とは混ぜられません`);
        return fail();
      }
      sheet = sh;
      // 前に保存したひな形の話題は使わない（話題は 2026-11-17 にやめた。0192 の追記）
      const { topics: _old, ...rest } = office.selection;
      void _old;
      start = { ...rest, name: `${CUSTOM_TEMPLATE}: ${office.name}` };
    } else {
      const names = [...AI_TEMPLATES, ...(ctx.officeTemplates ?? []).map((x) => x.name)];
      problems.push(`template ${show(t)}は選べません${near(t, names)}。選べるのは ${AI_TEMPLATES.join("・")}${(ctx.officeTemplates ?? []).length > 0 ? ` と事務所のひな形（${(ctx.officeTemplates ?? []).map((x) => x.name).join("・")}）` : ""}です`);
      return fail();
    }
  }
  sheet ??= "simple";
  const def = sheetDefOf(sheet);
  // 事務所のひな形が前の版の票で作られていれば、その版のまま使う（FP の画面と同じ）
  const useDef = start !== null ? (sheetOf(start) ?? def) : def;
  start ??= templateSelectionOf(kindOf(sheet), () => false);

  // 項目（書けば置き換える）
  let sections: SelectedSection[] = start.sections.filter((s) => s.id !== FP_SECTION.id).map((s) => ({ ...s, items: s.items.filter((i) => !i.key.startsWith("ext.office.")) }));
  let custom: CustomQuestion[] = [...start.custom];
  if (a.items !== undefined) {
    if (!Array.isArray(a.items)) {
      problems.push("items は項目の並び（[{ key, mode?, range? }]）で書いてください");
      return fail();
    }
    // ご相談したいことは選べない（お客さまの画面に出さない。0192 の追記 2026-11-17）
    const ok = new Set(selectableItems(useDef).map((i) => i.key).filter((k) => !HIDDEN_ITEMS.has(k)));
    const items = new Map(useDef.items.map((i) => [i.key, i]));
    const ranges = rangeMap(useDef);
    const plain = [...ok].filter((k) => items.get(k)?.rangeOf === undefined);
    const other = sheetDefOf(sheet === "simple" ? "detail" : "simple");
    const otherKeys = new Set(selectableItems(other).map((i) => i.key));
    const out = new Map<string, SelectedItem[]>();
    const seen = new Set<string>();
    a.items.forEach((x, n) => {
      const at = `items[${n}]`;
      if (typeof x !== "object" || x === null || Array.isArray(x)) {
        problems.push(`${at} は { key, mode?, range? } で書いてください`);
        return;
      }
      for (const k of Object.keys(x)) if (!["key", "mode", "range"].includes(k)) problems.push(`${at} に知らない名前があります: ${k}${near(k, ["key", "mode", "range"])}`);
      const key = (x as AiItemArg).key;
      if (typeof key !== "string") {
        problems.push(`${at}.key がありません`);
        return;
      }
      const it = items.get(key);
      if (it?.rangeOf !== undefined) {
        problems.push(`${at}.key ${show(key)}は「だいたいの範囲」の項目です。金額の項目 ${it.rangeOf} に range: true を書いてください（範囲は金額の項目と一緒に選びます）`);
        return;
      }
      if (HIDDEN_ITEMS.has(key)) {
        problems.push(`${at}.key ${show(key)}は選べる項目にありません（ご相談したいことは、お客さまの画面に出さないので選べません）`);
        return;
      }
      if (!ok.has(key)) {
        const inOther = otherKeys.has(key) && !ok.has(key);
        problems.push(
          inOther
            ? `${at}.key ${show(key)}は${sheet === "simple" ? "詳細" : "シンプル"}の票の項目です。シンプルと詳細の項目は1つの依頼に混ぜられません（sheet を変えるか、${sheet === "simple" ? "シンプル" : "詳細"}の票の項目にしてください）`
            : `${at}.key ${show(key)}は${sheet === "simple" ? "シンプル" : "詳細"}の票で選べる項目にありません${near(key, plain)}。get_hearing_options の sheets の items の key です`,
        );
        return;
      }
      if (seen.has(key)) {
        problems.push(`${at}.key ${show(key)}が2回あります`);
        return;
      }
      seen.add(key);
      const mode = (x as AiItemArg).mode ?? "ask";
      if (mode !== "ask" && mode !== "confirm") {
        problems.push(`${at}.mode ${show(mode)}は選べません。ask（空欄から聞く）か confirm（今の値を見せて確認してもらう）です`);
        return;
      }
      if (mode === "confirm") {
        if (useDef.sheetId !== "full") {
          problems.push(`${at}: 確認してもらう（confirm）にできるのは詳細の票だけです`);
          return;
        }
        if (filled === null) {
          problems.push(`${at}: 確認してもらう（confirm）は、渡された世帯（share_id）があるときだけ使えます`);
          return;
        }
        if (!filled.has(key)) {
          problems.push(`${at}: ${show(key)}は今の世帯に値が無いので、確認してもらう（confirm）にできません（ask にしてください）`);
          return;
        }
      }
      const range = (x as AiItemArg).range;
      if (range !== undefined && typeof range !== "boolean") {
        problems.push(`${at}.range は true か false で書いてください`);
        return;
      }
      if (range === true && !ranges.has(key)) {
        problems.push(`${at}: ${show(key)}には「だいたいの範囲」がありません（range は書かないでください）`);
        return;
      }
      const sid = sectionIdOf(useDef, key) as string;
      const list = out.get(sid) ?? [];
      list.push({ key, mode });
      const r = ranges.get(key);
      // 範囲は既定で付ける（ひな形と同じ）。range: false で外す
      if (r !== undefined && ok.has(r) && range !== false) list.push({ key: r, mode: "ask" });
      out.set(sid, list);
    });
    sections = [...out.entries()].map(([id, items]) => ({ id, items }));
  }

  // 独自の質問（書くと置き換える）
  if (a.custom !== undefined) {
    if (!Array.isArray(a.custom)) {
      problems.push("custom は独自の質問の並び（[{ label, help?, answer?, choices? }]）で書いてください");
      return fail();
    }
    if (a.custom.length > CUSTOM_MAX) problems.push(`独自の質問は${CUSTOM_MAX}問までです（${a.custom.length}問）`);
    custom = [];
    a.custom.slice(0, CUSTOM_MAX).forEach((c, n) => {
      const at = `custom[${n}]`;
      if (typeof c !== "object" || c === null || Array.isArray(c)) {
        problems.push(`${at} は { label, help?, answer?, choices? } で書いてください`);
        return;
      }
      const names = ["label", "help", "answer", "choices"];
      for (const k of Object.keys(c)) if (!names.includes(k)) problems.push(`${at} に知らない名前があります: ${k}${near(k, names)}`);
      const p1 = textProblem(c.label, `${at}.label`, CUSTOM_LABEL_MAX);
      if (p1 !== null) problems.push(p1);
      if (c.help !== undefined) {
        const p2 = textProblem(c.help, `${at}.help`, CUSTOM_HELP_MAX, true);
        if (p2 !== null) problems.push(p2);
      }
      const answer = c.answer ?? "text";
      if (!["text", "yesNo", "choice"].includes(answer)) {
        problems.push(`${at}.answer ${show(answer)}は選べません${near(String(answer), ["text", "yesNo", "choice"])}。text（自由に書く）・yesNo（はい・いいえ）・choice（選択肢から選ぶ）です`);
        return;
      }
      let choices: string[] | undefined;
      if (answer === "choice") {
        if (!Array.isArray(c.choices) || c.choices.length < 2 || c.choices.length > CUSTOM_CHOICES_MAX) {
          problems.push(`${at}.choices は2〜${CUSTOM_CHOICES_MAX}つの選択肢で書いてください`);
          return;
        }
        choices = [];
        for (const [i, ch] of c.choices.entries()) {
          const p = textProblem(ch, `${at}.choices[${i}]`, CUSTOM_CHOICE_LABEL_MAX);
          if (p !== null) problems.push(p);
          else choices.push((ch as string).trim());
        }
        if (new Set(choices).size !== choices.length) problems.push(`${at}.choices に同じ選択肢が2回あります`);
      } else if (c.choices !== undefined) problems.push(`${at}.choices は answer が choice のときだけ書けます`);
      if (typeof c.label !== "string") return;
      const label = c.label.trim();
      const help = typeof c.help === "string" ? c.help.trim() : "";
      custom.push({ key: aiCustomKey(n, label), label, ...(help !== "" ? { help } : {}), ...(answer === "yesNo" ? { answer: "yesNo" as const } : answer === "choice" && choices !== undefined ? { answer: "choice" as const, choices } : {}) });
    });
  }
  if (custom.length > 0) sections = [...sections, { id: FP_SECTION.id, items: custom.map((c) => ({ key: c.key, mode: "ask" as const })) }];

  // 頼む書類（書くと置き換える）
  let documents: RequestedDocument[] = [...start.documents];
  if (a.documents !== undefined) {
    if (!Array.isArray(a.documents)) {
      problems.push("documents は書類の並び（[{ kind, owner?, title?, purpose?, where? }]）で書いてください");
      return fail();
    }
    if (a.documents.length > DOCUMENT_LIMITS.documents) problems.push(`書類は${DOCUMENT_LIMITS.documents}通までです（${a.documents.length}通）`);
    documents = [];
    const kinds = DOCUMENT_TEMPLATES.map((d) => d.kind as string);
    a.documents.slice(0, DOCUMENT_LIMITS.documents).forEach((d, n) => {
      const at = `documents[${n}]`;
      if (typeof d !== "object" || d === null || Array.isArray(d)) {
        problems.push(`${at} は { kind, owner?, title?, purpose?, where? } で書いてください`);
        return;
      }
      const names = ["kind", "owner", "title", "purpose", "where"];
      for (const k of Object.keys(d)) if (!names.includes(k)) problems.push(`${at} に知らない名前があります: ${k}${near(k, names)}`);
      const tpl = typeof d.kind === "string" ? templateOf(d.kind) : undefined;
      if (tpl === undefined) {
        problems.push(`${at}.kind ${show(d.kind)}は頼める書類にありません${typeof d.kind === "string" ? near(d.kind, kinds) : ""}。get_hearing_options の documents の kind です`);
        return;
      }
      if (d.owner !== undefined && d.owner !== "self" && d.owner !== "spouse") {
        problems.push(`${at}.owner ${show(d.owner)}は選べません。self（ご本人）か spouse（配偶者の方）です`);
        return;
      }
      if (d.owner !== undefined && tpl.whose === "household") {
        problems.push(`${at}: ${tpl.title}は持ち主を選ばない書類です（owner は書かないでください）`);
        return;
      }
      for (const [k, max] of [["title", DOC_TITLE_MAX], ["purpose", DOC_TEXT_MAX], ["where", DOC_TEXT_MAX]] as const) {
        if (d[k] !== undefined) {
          const p = textProblem(d[k], `${at}.${k}`, max, k !== "title");
          if (p !== null) problems.push(p);
        }
      }
      if (tpl.kind === "other" && (typeof d.title !== "string" || d.title.trim() === "")) {
        problems.push(`${at}: その他の書類（other）は title（書類の名前）を書いてください`);
        return;
      }
      const owner: DocumentOwner | undefined = d.owner ?? (tpl.whose === "person" ? (documents.some((x) => x.kind === tpl.kind && x.owner === "self") ? "spouse" : "self") : undefined);
      if (owner !== undefined && documents.some((x) => x.kind === tpl.kind && x.owner === owner)) {
        problems.push(`${at}: ${tpl.title}（${OWNER_LABEL[owner]}）が2回あります`);
        return;
      }
      const doc: RequestedDocument = { id: `d${documents.length + 1}`, kind: tpl.kind, title: typeof d.title === "string" && d.title.trim() !== "" ? d.title.trim() : tpl.title, purpose: typeof d.purpose === "string" ? d.purpose.trim() : tpl.purpose, where: typeof d.where === "string" ? d.where.trim() : tpl.where };
      documents.push(withOwner(doc, owner));
    });
  }

  // 名前
  let name = start.name ?? CUSTOM_TEMPLATE;
  if (a.items !== undefined || a.custom !== undefined) name = t === undefined ? `${CUSTOM_TEMPLATE}（AI）` : `${CUSTOM_TEMPLATE}（${(start.name ?? "").replace(`${CUSTOM_TEMPLATE}: `, "")}から）`;
  if (a.name !== undefined) {
    const p = textProblem(a.name, "name", AI_NAME_MAX);
    if (p !== null) problems.push(p);
    else name = (a.name as string).trim();
  }
  if (problems.length > 0) return fail();

  const sel: WebSelection = { base: { sheetId: useDef.sheetId, version: useDef.version }, sections, custom, documents, name };
  const errs = checkSelection(useDef, sel);
  if (errs.length > 0) {
    problems.push(...errs);
    return fail();
  }
  const review = sel.sections.some((s) => s.items.some((i) => i.mode === "confirm"));
  return { selection: sel, problems: [], counts: countsOf(sel), review };
}

/** 聞く項目の数と、お客さまの画面の数・所要時間（前回の値は載せない目安。アプリが発行するときは前回の値を載せて数え直す） */
export function countsOf(sel: WebSelection, prefill?: Parameters<typeof packetBody>[2]["prefill"]): { selectedCount: number; screens: number; minutes: number } | null {
  const def = sheetOf(sel);
  if (def === undefined) return null;
  try {
    const p = packetBody(def, sel, { requestId: "R-COUNT1", expiresAt: "2099-01-01T00:00:00Z", office: { name: "", color: null, purpose: "", privacyContact: "" }, ...(prefill !== undefined ? { prefill } : {}) });
    const e = estimate(p);
    return { selectedCount: selectedCount(sel), screens: e.screens, minutes: e.minutes };
  } catch {
    return null;
  }
}

/** 選び方の要約（AI に返す: 分野ごとの聞く項目の名前・書類・独自の質問・話題の数） */
export function selectionSummary(sel: WebSelection): Record<string, unknown> {
  const def = sheetOf(sel);
  const items = new Map((def?.items ?? []).map((i) => [i.key, i]));
  return {
    sheet: aiSheetOf(sel.base.sheetId),
    name: sel.name ?? null,
    sections: sel.sections.map((s) => ({
      id: s.id,
      title: def === undefined ? s.id : sectionTitle(def, s.id),
      items: s.items.filter((i) => items.get(i.key)?.rangeOf === undefined).map((i) => ({ key: i.key, label: sel.custom.find((c) => c.key === i.key)?.label ?? items.get(i.key)?.label ?? i.key, ...(i.mode === "confirm" ? { mode: "confirm" } : {}) })),
    })),
    documents: sel.documents.map((d) => d.title),
  };
}

/** 事務所のひな形の名前の確かめ（40文字まで・制御文字なし。カスタム: の頭は付けない） */
export function templateNameProblem(v: unknown): string | null {
  return textProblem(v, "name", AI_NAME_MAX);
}

export { baseSheet };
