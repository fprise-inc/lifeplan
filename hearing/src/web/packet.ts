// Web のヒアリング（0125）の、FP の選び方・お客さまに届く問い（暗号化する前の中身）・お客さまから届く答え（暗号化する前の中身）の形。
// - 選び方（WebSelection）: 元にするシート定義（公式の basic か full の書き出せる版）の項目から、聞く項目・並び・確かめてもらう項目・
//   FP の独自の質問（ext.office.*。自由記述。計算に使わずメモに入る。0018 の3）・頼む書類を選ぶ。項目キーは公式のものをそのまま使う（0018 の5）
// - 取り込みは、アプリの側に残した依頼の記録（選び方と指紋）を正にする。届いた答えは信用しない: 形を確かめ、選んだ項目・繰り返しの範囲の外は捨てる
// - 答えの受け皿は Excel と同じ（filled-sheet の回答の一覧 Answer[]。依頼番号）。記入の年月（hs.meta.filledOn）は送った月をページが入れる
import type { Answer, RawValue } from "../answers.ts";
import { axisOf, itemByKey, type Axis, type SheetDefinition, type SheetItem } from "../definition.ts";
import { canonicalJson } from "../layout.ts";
import { DOCUMENT_LIMITS, type DocumentMime } from "./documents.ts";
import { sha256Hex } from "./e2e.ts";

export const QUESTIONS_FORMAT = "fprise-lifeplan-hearing-web-questions";
export const ANSWERS_FORMAT = "fprise-lifeplan-hearing-web-answers";
export const WEB_FORMAT_VERSION = "0.1";
/** 記入の年月（送った月をページが入れる。問いには出さない） */
export const FILLED_ON = "hs.meta.filledOn";
/** FP の独自の質問の項目キーの頭（0011 の拡張の名前空間。作成者は事務所） */
export const CUSTOM_PREFIX = "ext.office.";
export const CUSTOM_MAX = 10;
export const CUSTOM_LABEL_MAX = 120;
export const CUSTOM_HELP_MAX = 300;
export const CUSTOM_ANSWER_MAX = 1000;
/** 文の答え（自由記述）の上限 */
export const TEXT_ANSWER_MAX = 2000;

/** 項目の聞き方: ask は空欄から聞く、confirm は今の値を見せて確かめてもらう（見直し。元のシートが full のときだけ） */
export type ItemMode = "ask" | "confirm";

export interface SelectedItem {
  readonly key: string;
  readonly mode: ItemMode;
}

export interface SelectedSection {
  /** 元のシート定義の区画の id（FP の独自の質問だけの区画は "fp"） */
  readonly id: string;
  readonly items: readonly SelectedItem[];
}

export interface CustomQuestion {
  readonly key: string;
  readonly label: string;
  readonly help?: string;
}

/** 頼む書類1通 */
export interface RequestedDocument {
  /** 依頼の中の書類の ID（英小文字・数字。d1・d2 …） */
  readonly id: string;
  /** 公式のひな形（documents.ts。独自の書類は null） */
  readonly kind: string | null;
  /** 見出し（例: ねんきん定期便（ご本人）） */
  readonly title: string;
  /** 何のためか（FP が直せる） */
  readonly purpose: string;
  /** どこを写せばよいか（FP が直せる） */
  readonly where: string;
  /** 入力の画面の書類待ち（書類のお願いの1通の鍵。0102 の DocRequest.id）。結びつけないときは省く */
  readonly docRequest?: string;
}

export interface WebSelection {
  readonly base: { readonly sheetId: string; readonly version: number };
  readonly sections: readonly SelectedSection[];
  readonly custom: readonly CustomQuestion[];
  readonly documents: readonly RequestedDocument[];
}

export const FP_SECTION = { id: "fp", title: "担当の FP からの質問" } as const;

/** 問いに載せる項目（シート定義の項目の写し＋繰り返し・区画・前回の値） */
export interface WebItem {
  readonly key: string;
  readonly label: string;
  readonly type: SheetItem["type"];
  readonly unit?: SheetItem["unit"];
  readonly unitLabel?: string;
  readonly choices?: SheetItem["choices"];
  readonly ranges?: SheetItem["ranges"];
  readonly rangeOf?: string;
  readonly min?: number;
  readonly max?: number;
  readonly maxLength?: number;
  readonly example?: string;
  readonly guide?: string;
  readonly states: SheetItem["states"];
  readonly section: string;
  readonly axis?: { readonly id: string; readonly labels: readonly string[] };
  /** 確かめてもらう項目の前回の値（index → 答え。繰り返さない項目は 0） */
  readonly prefill?: Readonly<Record<string, Pick<Answer, "status" | "raw" | "raw2">>>;
  readonly confirm?: boolean;
  /** 「該当なし」のボタンの言葉（省略は「当てはまらない」。null は出さない: 分岐の問いで決まる欄） */
  readonly naLabel?: string | null;
}

export interface OfficeFace {
  readonly name: string;
  /** 基調の色（#rrggbb。0121。無ければページの標準の色） */
  readonly color: string | null;
  readonly purpose: string;
  readonly privacyContact: string;
}

/** お客さまに届く問い（暗号化する前の中身） */
export interface QuestionsPacket {
  readonly format: typeof QUESTIONS_FORMAT;
  readonly version: string;
  readonly requestId: string;
  readonly sheet: { readonly id: string; readonly version: number };
  readonly digest: string;
  readonly expiresAt: string;
  readonly office: OfficeFace;
  readonly title: string;
  readonly notes: readonly string[];
  readonly sections: readonly { readonly id: string; readonly title: string; readonly lead?: string }[];
  readonly items: readonly WebItem[];
  readonly consent: { readonly title: string; readonly lead: string; readonly items: readonly WebItem[] };
  readonly documents: readonly RequestedDocument[];
  readonly years: { readonly from: number; readonly to: number };
}

/** 書類1通の答え */
export interface DocumentAnswer {
  readonly id: string;
  /** attached 付けた・notAvailable 手元にない・later あとで送る・blank まだ */
  readonly status: "attached" | "notAvailable" | "later" | "blank";
  readonly files: readonly { readonly fileId: string; readonly mime: DocumentMime; readonly bytes: number; readonly sha256: string }[];
}

/** お客さまから届く答え（暗号化する前の中身） */
export interface AnswersPacket {
  readonly format: typeof ANSWERS_FORMAT;
  readonly version: string;
  readonly requestId: string;
  readonly submittedAt: string;
  readonly answers: readonly Answer[];
  readonly documents: readonly DocumentAnswer[];
}

// ---- 選び方 → 問い ----

const HIDDEN = new Set([FILLED_ON]);

/** 選べる項目（廃止していない・記入の年月と同意を除く） */
export function selectableItems(def: SheetDefinition): SheetItem[] {
  const consent = new Set(def.intro.consentItems);
  return def.items.filter((i) => i.retiredIn === null && !HIDDEN.has(i.key) && !consent.has(i.key));
}

/** ひな形: シートの全部の項目をシートの並びで（mode は全部 ask。confirm は呼ぶ側が決める） */
export function selectionFromSheet(def: SheetDefinition, mode: (key: string) => ItemMode = () => "ask"): WebSelection {
  const ok = new Set(selectableItems(def).map((i) => i.key));
  return {
    base: { sheetId: def.sheetId, version: def.version },
    sections: def.sections.map((s) => ({ id: s.id, items: s.groups.flatMap((g) => g.items).filter((k) => ok.has(k)).map((key) => ({ key, mode: mode(key) })) })).filter((s) => s.items.length > 0),
    custom: [],
    documents: [],
  };
}

/** 選び方の問題の一覧（空なら問題なし）。シート定義に無い項目・重なり・独自の質問の形・書類の数 */
export function checkSelection(def: SheetDefinition, s: WebSelection): string[] {
  const errs: string[] = [];
  if (s.base.sheetId !== def.sheetId || s.base.version !== def.version) errs.push("元のシートが違う");
  const ok = new Set(selectableItems(def).map((i) => i.key));
  const custom = new Map(s.custom.map((c) => [c.key, c]));
  const seen = new Set<string>();
  for (const sec of s.sections) {
    if (sec.id !== FP_SECTION.id && !def.sections.some((x) => x.id === sec.id)) errs.push(`知らない区画: ${sec.id}`);
    for (const it of sec.items) {
      if (seen.has(it.key)) errs.push(`項目が重なっている: ${it.key}`);
      seen.add(it.key);
      if (it.key.startsWith(CUSTOM_PREFIX)) {
        if (!custom.has(it.key)) errs.push(`独自の質問の中身が無い: ${it.key}`);
        if (it.mode !== "ask") errs.push(`独自の質問は確かめにできない: ${it.key}`);
      } else if (!ok.has(it.key)) errs.push(`選べない項目: ${it.key}`);
      if (it.mode === "confirm" && def.sheetId !== "full") errs.push(`確かめてもらえるのは詳細のシートだけ: ${it.key}`);
    }
  }
  if (s.custom.length > CUSTOM_MAX) errs.push(`独自の質問は${CUSTOM_MAX}問まで`);
  for (const c of s.custom) {
    if (!/^ext\.office\.q[a-z0-9]{4,12}$/.test(c.key)) errs.push(`独自の質問のキーの形が違う: ${c.key}`);
    if (c.label.trim() === "" || c.label.length > CUSTOM_LABEL_MAX) errs.push(`独自の質問の文が空か長すぎる: ${c.key}`);
    if ((c.help ?? "").length > CUSTOM_HELP_MAX) errs.push(`独自の質問の説明が長すぎる: ${c.key}`);
    if (!seen.has(c.key)) errs.push(`独自の質問が並びに無い: ${c.key}`);
  }
  if (s.documents.length > DOCUMENT_LIMITS.documents) errs.push(`書類は${DOCUMENT_LIMITS.documents}通まで`);
  const ids = new Set<string>();
  for (const d of s.documents) {
    if (!/^d[0-9]{1,3}$/.test(d.id) || ids.has(d.id)) errs.push(`書類の ID の形が違うか重なっている: ${d.id}`);
    ids.add(d.id);
    if (d.title.trim() === "" || d.title.length > 80 || d.purpose.length > 200 || d.where.length > 200) errs.push(`書類の文が空か長すぎる: ${d.id}`);
  }
  if (seen.size === 0 && s.documents.length === 0) errs.push("聞く項目も頼む書類もありません");
  return errs;
}

/** 選び方の指紋（0018 の5 の配置の指紋に当たるもの。元のシート・項目と並び・聞き方・独自の質問のキー・書類の ID と種類。文の言い回しは入れない） */
export async function selectionDigest(s: WebSelection): Promise<string> {
  return sha256Hex(canonicalJson({ web: WEB_FORMAT_VERSION, base: s.base, sections: s.sections, custom: s.custom.map((c) => c.key), documents: s.documents.map((d) => [d.id, d.kind]) }));
}

/** 「該当なし」のボタンの言葉（Web では、配偶者の方がいるか・人数は分岐の問いで聞くので、家族の欄には出さない） */
const NA_LABEL: Readonly<Record<string, string | null>> = {
  "hs.family.adult.birthYearMonth": null,
  "hs.family.adult.age": null,
  "hs.family.adult.sex": null,
  "hs.family.spouse.marriage": null,
  "hs.work.type": "働いていない",
  "hs.education.elementary": "卒業した",
  "hs.education.juniorHigh": "卒業した",
  "hs.education.highSchool": "卒業した",
  "hs.education.after": "進学しない",
  "hs.insurance.payUntilAge": "終身払い",
  "hs.housing.rent": "家賃はない",
};

/** シートの手引きの文を Web の言葉にする（「該当なし」→「当てはまらない」。分岐の問いで聞く「配偶者の方がいらっしゃらない場合」の文は外す） */
export function webGuide(text: string | undefined, key?: string): string | undefined {
  if (text === undefined) return undefined;
  const na = key === undefined ? undefined : NA_LABEL[key];
  const t = text
    .split(/(?<=。)/)
    .filter((x) => !x.includes("配偶者の方がいらっしゃらない"))
    .join("")
    .replaceAll("「該当なし」", `「${na ?? "当てはまらない"}」`)
    .trim();
  return t === "" ? undefined : t;
}

function webItem(def: SheetDefinition, i: SheetItem, section: string): WebItem {
  const axis = axisOf(def, i.key);
  const guide = webGuide(i.guide, i.key);
  const copy = <K extends keyof SheetItem>(k: K) => (i[k] !== undefined ? { [k]: i[k] } : {});
  return {
    key: i.key,
    label: i.label,
    type: i.type,
    ...copy("unit"),
    ...copy("unitLabel"),
    ...copy("choices"),
    ...copy("ranges"),
    ...copy("rangeOf"),
    ...copy("min"),
    ...copy("max"),
    ...copy("maxLength"),
    ...copy("example"),
    ...(guide !== undefined ? { guide } : {}),
    states: i.states,
    section,
    ...(axis !== null ? { axis: axisFace(axis) } : {}),
    ...(i.states.includes("notApplicable") && NA_LABEL[i.key] !== undefined ? { naLabel: NA_LABEL[i.key] as string | null } : {}),
  };
}

const axisFace = (a: Axis) => ({ id: a.id, labels: a.labels.slice(0, a.count) });

export interface PacketOptions {
  readonly requestId: string;
  readonly expiresAt: string;
  readonly office: OfficeFace;
  /** 確かめてもらう項目の前回の値（exportAnswers の答え） */
  readonly prefill?: readonly Answer[];
}

/** 選び方から問いを作る（選び方は checkSelection で確かめてから） */
export async function buildPacket(def: SheetDefinition, s: WebSelection, o: PacketOptions): Promise<QuestionsPacket> {
  const errs = checkSelection(def, s);
  if (errs.length > 0) throw new Error(`E_WEB_SELECTION: ${errs.join("・")}`);
  const items = itemByKey(def);
  const custom = new Map(s.custom.map((c) => [c.key, c]));
  const out: WebItem[] = [];
  for (const sec of s.sections) {
    for (const it of sec.items) {
      const c = custom.get(it.key);
      if (c !== undefined) {
        out.push({ key: c.key, label: c.label, type: "text", maxLength: CUSTOM_ANSWER_MAX, states: [], section: sec.id, ...(c.help !== undefined && c.help !== "" ? { guide: c.help } : {}) });
        continue;
      }
      const base = webItem(def, items.get(it.key) as SheetItem, sec.id);
      if (it.mode !== "confirm") {
        out.push(base);
        continue;
      }
      const prefill: Record<string, Pick<Answer, "status" | "raw" | "raw2">> = {};
      for (const a of o.prefill ?? []) {
        if (a.key !== it.key || a.status === "blank") continue;
        prefill[String(a.index ?? 0)] = { status: a.status, ...(a.raw !== undefined ? { raw: a.raw } : {}), ...(a.raw2 !== undefined ? { raw2: a.raw2 } : {}) };
      }
      out.push({ ...base, confirm: true, ...(Object.keys(prefill).length > 0 ? { prefill } : {}) });
    }
  }
  const sections = s.sections.map((sec) => {
    if (sec.id === FP_SECTION.id) return { id: sec.id, title: FP_SECTION.title };
    const d = def.sections.find((x) => x.id === sec.id);
    // 区画の題の番号（「2. ご家族」）は並びが変わるので外す
    return { id: sec.id, title: (d?.title ?? sec.id).replace(/^\d+\.\s*/, ""), ...(d?.lead !== undefined ? { lead: d.lead } : {}) };
  });
  const consent = def.intro.consentItems.map((k) => webItem(def, items.get(k) as SheetItem, "consent"));
  return {
    format: QUESTIONS_FORMAT,
    version: WEB_FORMAT_VERSION,
    requestId: o.requestId,
    sheet: { id: def.sheetId, version: def.version },
    digest: await selectionDigest(s),
    expiresAt: o.expiresAt,
    office: o.office,
    title: def.intro.title,
    notes: WEB_NOTES,
    sections,
    items: out,
    consent: { title: def.intro.consentTitle, lead: def.intro.consentLead, items: consent },
    documents: s.documents,
    years: def.years,
  };
}

/** お客さまのページの最初の画面の注意（シートの注意書きの Web 版） */
export const WEB_NOTES: readonly string[] = [
  "お名前は書かないでください。番号でお客さまを見分けます。",
  "わからない問いは「わからない」、当てはまらない問いは「当てはまらない」を選んでください。「あとで」で飛ばして、最後にまとめて見直せます。",
  "次のことはお聞きしません: 病歴など健康の情報、マイナンバー・基礎年金番号などの番号、口座番号。",
  "途中で閉じても、この端末のこのブラウザなら続きから答えられます（端末の中に暗号化して残します）。",
];

// ---- 取り込みに使うシート定義（選んだ項目だけ） ----

/**
 * 選び方から、取り込みに使うシート定義を作る（元のシート定義から選んだ項目・同意・記入の年月だけを残し、独自の質問をメモの項目として足す）。
 * シートID と版は元のまま（取り込みの手順が版の決まりで読むため）。選ばなかった項目は「このシートではお聞きしていません」になる
 */
export function importDefinition(def: SheetDefinition, s: WebSelection): SheetDefinition {
  const keep = new Set<string>([FILLED_ON, ...def.intro.consentItems, ...s.sections.flatMap((x) => x.items.map((i) => i.key))]);
  // 範囲の答えの元の金額の項目（範囲だけを選んだとき、取り込みが範囲を金額に読むために要る。答えは来ないので空欄のまま）
  for (const i of def.items) if (keep.has(i.key) && i.rangeOf !== undefined) keep.add(i.rangeOf);
  const items: SheetItem[] = def.items.filter((i) => keep.has(i.key));
  for (const c of s.custom) items.push({ key: c.key, label: c.label, type: "text", maxLength: CUSTOM_ANSWER_MAX, states: [], inputItems: [], destination: "memo", addedIn: def.version, retiredIn: null });
  const sections = def.sections.map((sec) => ({ ...sec, groups: sec.groups.map((g) => ({ ...g, items: g.items.filter((k) => keep.has(k)) })).filter((g) => g.items.length > 0) })).filter((sec) => sec.groups.length > 0);
  if (s.custom.length > 0) sections.push({ id: FP_SECTION.id, title: FP_SECTION.title, groups: [{ id: "fp", items: s.custom.map((c) => c.key) }] });
  const rows = def.layout.rows.filter((r) => r.kind !== "item" || keep.has(r.key));
  return { ...def, items, sections, layout: { ...def.layout, rows } };
}

// ---- 届いた答えを確かめる（信用しない） ----

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readRaw(v: unknown, max: number): RawValue | null {
  if (!isObj(v)) return null;
  if (v.kind === "bool" && typeof v.value === "boolean" && Object.keys(v).length === 2) return { kind: "bool", value: v.value };
  if ((v.kind === "number" || v.kind === "text") && typeof v.text === "string" && Object.keys(v).length === 2 && v.text.length <= max) return { kind: v.kind, text: v.text };
  return null;
}

export interface CheckedAnswers {
  readonly answers: Answer[];
  readonly documents: DocumentAnswer[];
  readonly submittedAt: string;
  /** 捨てた答え（形が違う・選んでいない項目・範囲の外など）の数 */
  readonly dropped: number;
}

/**
 * 届いた答えの中身（JSON）を確かめる。形の違うものは E_WEB_ANSWERS_SHAPE、依頼番号が違えば E_WEB_ANSWERS_REQUEST。
 * 選んでいない項目・繰り返しの範囲の外・選べない状態・重なりは捨てて数える（黙って取り込まない）
 */
export function checkAnswers(json: unknown, def: SheetDefinition, s: WebSelection, requestId: string): CheckedAnswers {
  if (!isObj(json) || json.format !== ANSWERS_FORMAT || typeof json.version !== "string" || !/^0\.\d+$/.test(json.version) || !Array.isArray(json.answers) || !Array.isArray(json.documents) || typeof json.submittedAt !== "string") throw new Error("E_WEB_ANSWERS_SHAPE");
  if (json.requestId !== requestId) throw new Error("E_WEB_ANSWERS_REQUEST");
  if (json.answers.length > 2000 || json.documents.length > DOCUMENT_LIMITS.documents) throw new Error("E_WEB_ANSWERS_SHAPE");
  const idef = importDefinition(def, s);
  const items = itemByKey(idef);
  const seen = new Set<string>();
  const answers: Answer[] = [];
  let dropped = 0;
  for (const a of json.answers as unknown[]) {
    if (!isObj(a) || typeof a.key !== "string" || typeof a.status !== "string") {
      dropped++;
      continue;
    }
    const it = items.get(a.key);
    const axis = it === undefined ? null : axisOf(idef, a.key);
    const index = a.index === undefined ? undefined : a.index;
    const okIndex = axis === null ? index === undefined : typeof index === "number" && Number.isInteger(index) && index >= 1 && index <= axis.count;
    const status = a.status;
    const okStatus = status === "value" || status === "blank" || ((status === "unknown" || status === "notApplicable") && it !== undefined && it.states.includes(status));
    const tag = `${a.key}#${String(index ?? 0)}`;
    if (it === undefined || !okIndex || !okStatus || seen.has(tag)) {
      dropped++;
      continue;
    }
    seen.add(tag);
    const max = it.type === "text" ? (it.maxLength ?? TEXT_ANSWER_MAX) : 64;
    const raw = a.raw === undefined ? undefined : readRaw(a.raw, max);
    const raw2 = a.raw2 === undefined ? undefined : readRaw(a.raw2, 16);
    if (raw === null || raw2 === null || (status === "value" && raw === undefined)) {
      dropped++;
      continue;
    }
    answers.push({ key: a.key, ...(index !== undefined ? { index: index as number } : {}), status: status as Answer["status"], ...(status === "value" && raw !== undefined ? { raw } : {}), ...(status === "value" && raw2 !== undefined ? { raw2 } : {}) });
  }
  const docIds = new Set(s.documents.map((d) => d.id));
  const documents: DocumentAnswer[] = [];
  let files = 0;
  let total = 0;
  for (const d of json.documents as unknown[]) {
    if (!isObj(d) || typeof d.id !== "string" || !docIds.has(d.id) || !["attached", "notAvailable", "later", "blank"].includes(d.status as string) || !Array.isArray(d.files) || documents.some((x) => x.id === d.id)) {
      dropped++;
      continue;
    }
    const list: DocumentAnswer["files"][number][] = [];
    for (const f of (d.files as unknown[]).slice(0, DOCUMENT_LIMITS.filesPerDocument)) {
      if (!isObj(f) || typeof f.fileId !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(f.fileId) || !["image/jpeg", "image/png", "image/heic", "application/pdf"].includes(f.mime as string) || typeof f.bytes !== "number" || !Number.isInteger(f.bytes) || f.bytes <= 0 || f.bytes > DOCUMENT_LIMITS.fileBytes || typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) {
        dropped++;
        continue;
      }
      files++;
      total += f.bytes;
      if (files > DOCUMENT_LIMITS.files || total > DOCUMENT_LIMITS.totalBytes) throw new Error("E_WEB_ANSWERS_SHAPE");
      list.push({ fileId: f.fileId, mime: f.mime as DocumentMime, bytes: f.bytes, sha256: f.sha256 });
    }
    const status = d.status as DocumentAnswer["status"];
    documents.push({ id: d.id, status: status === "attached" && list.length === 0 ? "blank" : status, files: status === "attached" ? list : [] });
  }
  return { answers, documents, submittedAt: json.submittedAt.slice(0, 40), dropped };
}
