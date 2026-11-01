// 書類のお願い（1段目。0102）: 世帯の「書類待ち」（値の状態 unknown。欄の定義の docCheck を持つ欄）から、お客さまに送ってもらう書類の一覧を作る。
// - 一覧は確かめの一覧の書類待ちの行（checkRows.ts）から毎回作る（保存しない。世帯ファイルの形は変えない）。書類の値を打つ・「この値にする」で
//   欄が書類待ちでなくなると、一覧からも消える
// - 同じ書類は持ち主ごとに1行にまとめる: 人の書類（ねんきん定期便・住民税の決定通知書・退職金の規程）は構成員ごと、保険証券は契約ごと、
//   返済予定表はローンごと（今の住宅ローン・今返している自動車ローン）。1行には、その書類で確かめる欄（名前・今の代わりの値・欄へ移る先）を並べる（写すときの手引き）
// - お客さまへの文（requestMessage）は書類の名前と確かめる欄の名前だけで、金額・番号・顧客番号は入れない。呼び方は「ご本人」「配偶者」
//   （FP が付けた呼び名は使わない。0012）。お名前・事務所名は FP がその場で入れたときだけ入れ、無ければ置きかえる所の印にする
// - 受け取り方の注意（SAFE_SENDING）は FP 向けの説明。後でアプリの中の暗号化した受け取りを作るときも、この一覧の1行を受け取りの単位にする
import { roles } from "../roles.ts";
import { checkList, type CheckRow } from "./checkRows.ts";
import { CHECK_DOCUMENTS } from "./checkDocuments.ts";
import type { Level } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { kindOf } from "./insuranceKinds.ts";

/** 書類で確かめる欄1つ（写すときの手引き） */
export interface DocRequestValue {
  /** 確かめの一覧の行の ID */
  rowId: string;
  card: string;
  cardLabel: string;
  /** 確かめの一覧の見出し（まとまりの名前: 欄の名前） */
  label: string;
  /** 欄の名前（お客さまへの文に出す） */
  field: string;
  /** 今の代わりの値（言葉で） */
  value: string | null;
  /** 書類待ちの文（「〇〇で確かめる（代わりの値: …）」） */
  detail: string | null;
  fieldKey: string | null;
  level: Level;
}

/** 送ってほしい書類1通（持ち主ごと） */
export interface DocRequest {
  /** 書類と持ち主の鍵（画面の行の ID） */
  id: string;
  /** 書類の名前（例: 住宅ローンの返済予定表） */
  doc: string;
  /** 持ち主の言葉（例: ご本人・医療保険・ご本人）。決まらなければ null */
  whose: string | null;
  /** 一覧の見出し（例: ねんきん定期便（ご本人）） */
  title: string;
  values: DocRequestValue[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** 世帯の物の集まりから ID の物を探す（集まりの名前つき） */
function locate(wh: WorkingHousehold, id: string): { coll: string; obj: Obj } | null {
  const h = wh.request.input.household as unknown as Obj;
  for (const [coll, v] of Object.entries(h)) if (Array.isArray(v)) for (const x of v) if (isObj(x) && x.id === id) return { coll, obj: x };
  return null;
}

/** 書類の持ち主: まとめる鍵・書類の名前（ローンの種類で言い分ける）・持ち主の言葉 */
function ownerOf(wh: WorkingHousehold, doc: string, holder: string | null, who: (id: unknown) => string): { group: string; doc: string; whose: string | null } {
  const at = holder === null ? null : locate(wh, holder);
  if (at === null || holder === null) return { group: holder ?? "", doc, whose: null };
  const { coll, obj } = at;
  switch (coll) {
    case "members":
      return { group: holder, doc, whose: who(holder) };
    case "residentTaxAssessments":
    case "pensionRecords":
    case "retirementBenefits":
      // 人の書類は、同じ人の物（退職一時金と企業年金など）を1通にまとめる
      return { group: typeof obj.member === "string" ? obj.member : holder, doc, whose: who(obj.member) };
    case "insuranceContracts": {
      const name = str(obj.label) ?? kindOf(obj as { subtype?: string; template: string }).label;
      return { group: holder, doc, whose: `${name}・${who(obj.insured)}` };
    }
    case "debts": {
      const debtors = Array.isArray(obj.debtors) ? obj.debtors : [];
      const first = isObj(debtors[0]) ? debtors[0].member : undefined;
      const kind = obj.kind === "mortgage" ? "住宅ローン" : obj.kind === "car" ? "自動車ローン" : "ローン";
      return { group: holder, doc: doc === CHECK_DOCUMENTS.loan ? `${kind}の${doc}` : doc, whose: str(obj.label) ?? who(first) };
    }
    default:
      return { group: holder, doc, whose: null };
  }
}

/**
 * 送ってほしい書類の一覧（書類待ちの欄から。並びは確かめの一覧と同じ入力項目の順）。rows を渡すとその確かめの一覧から作る
 * （画面ですでに作った一覧を使い回す）
 */
export function docRequests(wh: WorkingHousehold, rows: readonly CheckRow[] = checkList(wh)): DocRequest[] {
  const names = new Map(roles(wh.request).map((r) => [r.member.id, r.label]));
  const who = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? "ご家族") : "ご家族");
  const out = new Map<string, DocRequest>();
  for (const r of rows) {
    if (r.kind !== "unknown" || r.doc === undefined) continue;
    const o = ownerOf(wh, r.doc.name, r.doc.holder, who);
    const id = `${o.doc}|${o.group}`;
    let e = out.get(id);
    if (e === undefined) {
      e = { id, doc: o.doc, whose: o.whose, title: o.whose !== null ? `${o.doc}（${o.whose}）` : o.doc, values: [] };
      out.set(id, e);
    }
    e.values.push({ rowId: r.id, card: r.card, cardLabel: r.cardLabel, label: r.label, field: r.doc.field, value: r.value ?? null, detail: r.detail, fieldKey: r.fieldKey, level: r.level });
  }
  // 同じ見出しが2つ以上（名前の無いローンが同じ人に2本など）は、2件目から番号を添える
  const list = [...out.values()];
  const seen = new Map<string, number>();
  for (const e of list) {
    const n = (seen.get(e.title) ?? 0) + 1;
    seen.set(e.title, n);
    if (n > 1) e.title = e.whose !== null ? `${e.doc}（${e.whose}・${n}件目）` : `${e.doc}（${n}件目）`;
  }
  return list;
}

/** お客さまへの文に入れる、その場の言葉（保存しない） */
export interface MessageOptions {
  /** お客さまのお名前（空なら「〇〇」） */
  name?: string;
  /** 事務所名（空なら「（事務所名）」） */
  office?: string;
}

export const NAME_PLACEHOLDER = "〇〇";
export const OFFICE_PLACEHOLDER = "（事務所名）";

/** 番号を隠してよいことの一文（文にも、ヒアリングシートの書類のお願いにも入れる） */
export const MASK_NOTE = "証券番号・口座番号などは隠していただいてかまいません。";

/**
 * メール・メッセージに貼るお願いの文（書類の名前と確かめる欄の名前だけ。金額・番号は入れない）。
 * 書類が無ければ空の文
 */
export function requestMessage(reqs: readonly DocRequest[], o: MessageOptions = {}): string {
  if (reqs.length === 0) return "";
  const name = o.name?.trim() || NAME_PLACEHOLDER;
  const office = o.office?.trim() || OFFICE_PLACEHOLDER;
  const lines = [
    `${name}様`,
    "",
    `いつもお世話になっております。${office}です。`,
    "ライフプランをより正確にお作りするため、お手元に次の書類がございましたら、拝見できますでしょうか。",
    "",
  ];
  for (const r of reqs) {
    lines.push(`・${r.title}`);
    const fields = [...new Set(r.values.map((v) => v.field))];
    if (fields.length > 0) lines.push(`\u3000（拝見したい所: ${fields.join("、")}）`);
  }
  lines.push(
    "",
    MASK_NOTE,
    "スマートフォンで撮った写真でもかまいません。お手元に無いものは、その旨をお知らせいただければ結構です。",
    "",
    "お送りいただくときは、こちらからご案内する方法（アップロード用のリンクなど）をお使いください。パスワード付きの圧縮ファイルをメールでお送りいただく必要はありません。次回の面談にお持ちいただくのでもかまいません。",
    "いただいた書類は、数字を写し終えたら削除いたします。",
    "",
    "どうぞよろしくお願いいたします。",
  );
  return lines.join("\n");
}

/** ヒアリングシートの1枚目に載せる書類の一覧（見出しの言葉だけ） */
export const docRequestTitles = (reqs: readonly DocRequest[]): string[] => reqs.map((r) => r.title);

/** FP 向けの、書類の受け取り方の注意（見出しと文） */
export const SAFE_SENDING: readonly { title: string; text: string }[] = [
  {
    title: "パスワード付きの圧縮ファイルをメールで受け取らない",
    text: "圧縮ファイルとパスワードを同じメールの経路で送る形は、途中で読まれれば両方とも読まれ、守りになりません。お客さまの手間も増えます。お客さまにこの形を頼まないでください。",
  },
  {
    title: "アップロード専用のリンクで受け取る",
    text: "クラウドの保存サービスの多くに、ファイルを出してもらうだけのリンク（「ファイルのリクエスト」などの名前の機能）があります。お客さまは置くだけで、ほかのファイルは見えません。リンクには期限を付け、受け取ったら閉じてください。",
  },
  {
    title: "写し終えたら消す",
    text: "数字をこのアプリに写したら、受け取った書類（写真・PDF）を、保存サービス・ダウンロードのフォルダ・メールの添付から消してください（ごみ箱も空にします）。",
  },
  {
    title: "書類の画像は世帯ファイルに入れない",
    text: "このアプリは書類の画像を持ちません。写すのは数字だけです。証券番号・口座番号・基礎年金番号などの番号も入れません（お客さまに隠してもらってかまいません）。",
  },
];
