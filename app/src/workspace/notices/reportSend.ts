// 送る報告の確認画面（0259）の中身: 名前・金額らしい所の印、写す文の組み立て、送り方（1か所）。
// - 印は知らせるだけ（消すかどうかは FP が決める。送るのは止めない）。名前は形で見分けられないので、敬称・名前の欄・全角の空白で区切った
//   漢字の並びだけを見る（「不動産屋さん」「お客さま」のようなふつうの言葉や、建物の名前には付けない）
// - 送り方は sendReport の1か所: 今は「文をクリップボードに写す → フォームを既定のブラウザで開く（隠れた欄は受付番号・版・OS と、AI 経由なら via=ai）」。
//   報告の文は URL に入れない（URL は履歴やログに残るため）。自前の受け付けができたら、ここを直接送る形に替える
import type { Receipt } from "./receipts.ts";

/** 印の種類 */
export type ReportMarkKind = "name" | "money" | "digits" | "date" | "phone" | "email" | "address";

/** 印の種類の言葉（画面に出す） */
export const MARK_LABEL: Record<ReportMarkKind, string> = {
  name: "名前らしい",
  money: "金額らしい",
  digits: "数字の並び",
  date: "日付（生年月日かもしれません）",
  phone: "電話番号らしい",
  email: "メールアドレス",
  address: "住所らしい",
};

/** 印（文の中の位置。start は含み、end は含まない） */
export interface ReportMark {
  kind: ReportMarkKind;
  start: number;
  end: number;
  text: string;
}

const D = "[0-9０-９]";
const PREF =
  "北海道|東京都|京都府|大阪府|(?:青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)県";
/** 地名の文字（漢字・カタカナ・ひらがな） */
const PLACE_CHARS = "[一-龥々ヶァ-ヴーぁ-ゖ]";
/** 地名の途中に来ない助詞（「東京都の世帯で…区分」を住所にしない） */
const PARTICLES = /[のはがをにでともへ]/;

/** 名前の後に付く敬称 */
const HONORIFIC = "さん|様|さま|氏|くん|君|ちゃん|殿";
/** 敬称が付いても名前ではない言葉（人の続き柄・役目・お客さまなど） */
const NOT_NAMES = new Set([
  "客", "主人", "奥", "皆", "旦那", "息子", "娘", "父", "母", "兄", "姉", "弟", "妹", "夫", "妻", "嫁", "婿", "孫", "子", "相手", "本人", "家族", "親", "親御", "祖父", "祖母", "叔父", "叔母", "伯父", "伯母", "彼", "彼女", "先生", "大家", "家主", "皆様", "皆さま", "担当", "営業", "相談者", "利用者", "ご本人",
  "ユーザー", "オーナー", "パートナー", "スタッフ", "ゲスト", "メンバー", "クライアント", "ドクター", "ママ", "パパ", "お客",
]);
/** 名前の後ろがこの字で終わる言葉は、店・会社・役目（不動産屋さん・銀行さん・税理士さん・部長さん） */
const NOT_NAME_ENDINGS = /[屋店社行者家士員方所局院庁先長側達等員師業会課係部室]$/;

interface Rule {
  kind: ReportMarkKind;
  re: RegExp;
  /** 当たった所を印にするか（false なら付けない） */
  keep?: (m: RegExpExecArray, text: string) => boolean;
  /** 印にする部分（既定は当たった所の全部） */
  part?: (m: RegExpExecArray) => { start: number; end: number };
}

const digitCount = (s: string) => (s.match(/[0-9０-９]/g) ?? []).length;

// 先に書いた決まりが勝つ（重なる所には後の決まりの印を付けない）
const RULES: Rule[] = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g },
  // 日付: 後ろに時刻が続くもの（エラーの記録の日時）は印にしない
  {
    kind: "date",
    re: new RegExp(`(?:(?:19|20)${D}{2}|(?:昭和|平成|令和)${D}{1,2})[年/\\-.－]${D}{1,2}[月/\\-.－]${D}{1,2}日?`, "g"),
    keep: (m, text) => !/^\s?[0-9０-９]{1,2}[:：][0-9０-９]{2}/.test(text.slice(m.index + m[0].length)),
  },
  {
    kind: "phone",
    re: new RegExp(`(?<![0-9０-９])(?:\\+81[-\\s]?|[0０])${D}{1,4}[-－‐ー(（\\s]?${D}{1,4}[-－‐ー)）\\s]?${D}{3,4}(?![0-9０-９])`, "g"),
    keep: (m) => {
      const n = digitCount(m[0]) + (m[0].startsWith("+81") ? 1 : 0);
      return n >= 10 && n <= 12;
    },
  },
  { kind: "address", re: new RegExp(`〒\\s?${D}{3}[-－ー]?${D}{4}|(?<![0-9０-９])${D}{3}[-－]${D}{4}(?![0-9０-９-－])`, "g") },
  {
    kind: "address",
    // 都道府県と最初の市区町村の間に助詞があるもの（「東京都の世帯で…区分」）は住所にしない（「丸の内」のように後ろの地名の「の」は構わない）
    keep: (m) => {
      const pref = new RegExp(`^(?:${PREF})`).exec(m[0])?.[0].length ?? 0;
      const city = m[0].slice(pref).search(/[市区町村郡]/);
      return !PARTICLES.test(m[0].slice(pref, pref + Math.max(0, city)));
    },
    re: new RegExp(`(?:${PREF})${PLACE_CHARS}{0,12}?(?:市|区|町|村|郡)(?:${PLACE_CHARS}{0,12}?(?:市|区|町|村))?(?:${PLACE_CHARS}{0,8}${D}+(?:丁目|番地?|号|[-－]${D}+)+)?`, "g"),
  },
  {
    kind: "address",
    // 年-月-日の形（エラーの記録の日時など）は番地にしない
    keep: (m) => !/^(?:19|20)[0-9０-９]{2}[-－][0-9０-９]{1,2}[-－][0-9０-９]{1,2}$/.test(m[0]),
    re: new RegExp(`${D}+丁目(?:${D}+番(?:地)?)?(?:${D}+号)?|${D}+番地(?:${D}+)?|(?<![0-9０-９.])${D}{1,4}[-－]${D}{1,4}[-－]${D}{1,4}(?![0-9０-９])`, "g"),
  },
  { kind: "money", re: new RegExp(`[¥￥]\\s?${D}[0-9０-９,，]*|${D}[0-9０-９,，.]*\\s?(?:万|億|千)?\\s?円|${D}[0-9０-９,，.]*\\s?(?:万|億)(?![年人歳回件か])|[一二三四五六七八九十百千〇]+(?:万|億)円?|[一二三四五六七八九十百千]+円`, "g") },
  // 数字の並び: 5桁以上か、3桁ごとの区切りのある数
  {
    kind: "digits",
    re: new RegExp(`(?<![0-9０-９.])${D}[0-9０-９,，]*${D}(?![0-9０-９.])`, "g"),
    keep: (m) => digitCount(m[0]) >= 5 || /[,，][0-9０-９]{3}/.test(m[0]),
  },
  // 名前の欄（氏名: ○○）
  {
    kind: "name",
    re: /(?:氏名|お名前|名前)\s*[:：]\s*([^\s、。,，:：]{1,20})/g,
    part: (m) => {
      const v = m[1] ?? "";
      const end = m.index + m[0].length;
      return { start: end - v.length, end };
    },
  },
  // 敬称の付いた名前（山田さん・佐藤様・ヤマダさん）
  {
    kind: "name",
    re: new RegExp(`([一-龥々ヶ]{1,4}|[ァ-ヴー]{2,8})(?:${HONORIFIC})`, "g"),
    keep: (m, text) => {
      const stem = m[1] ?? "";
      const honorific = m[0].slice(stem.length);
      const before = text.slice(Math.max(0, m.index - 1), m.index);
      if (before === "お" || before === "ご") return false;
      if (NOT_NAMES.has(stem) || NOT_NAME_ENDINGS.test(stem)) return false;
      // 漢字1字の敬称（様・氏・君・殿）は、言葉の一部のことが多い（同様・多様・仕様書・諸君・両氏）: 2字以上の名前で、後ろに漢字が続かないものだけ
      if (/^[様氏君殿]$/.test(honorific)) return stem.length >= 2 && !/^[一-龥々]/.test(text.slice(m.index + m[0].length));
      return true;
    },
  },
  // 全角の空白（U+3000）で区切った漢字の並び（山田と太郎の間が全角の空白）
  { kind: "name", re: /(?<![一-龥々])[一-龥々]{1,3}\u3000[一-龥々]{1,3}(?![一-龥々])/g },
];

/** 文の中の、名前・金額・電話番号・メール・住所・生年月日らしい所（文の前から順。重ならない） */
export function reportMarks(text: string): ReportMark[] {
  const out: ReportMark[] = [];
  const taken = (s: number, e: number) => out.some((m) => s < m.end && m.start < e);
  for (const r of RULES) {
    r.re.lastIndex = 0;
    for (let m = r.re.exec(text); m !== null; m = r.re.exec(text)) {
      if (m[0] === "") {
        r.re.lastIndex++;
        continue;
      }
      if (r.keep !== undefined && !r.keep(m, text)) continue;
      const { start, end } = r.part?.(m) ?? { start: m.index, end: m.index + m[0].length };
      if (end <= start || taken(start, end)) continue;
      out.push({ kind: r.kind, start, end, text: text.slice(start, end) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 文を、印の所と印でない所に分ける（画面で印を付けて出すため） */
export function markedParts(text: string, marks: readonly ReportMark[]): { text: string; mark: ReportMark | null }[] {
  const parts: { text: string; mark: ReportMark | null }[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.start > at) parts.push({ text: text.slice(at, m.start), mark: null });
    parts.push({ text: text.slice(m.start, m.end), mark: m });
    at = m.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), mark: null });
  return parts;
}

/** 「どの画面のことですか」の選択肢（受け付けのフォームの選択肢と同じ） */
export const REPORT_SCREENS = ["入力", "結果", "資産と負債", "万一のとき", "提案書", "事務所の設定・保存", "AI 接続", "URL で答えるヒアリング", "その他・分からない"] as const;
export type ReportScreen = (typeof REPORT_SCREENS)[number];

/** AI が書いた画面の言葉を、選択肢に寄せる（当たらなければ「その他・分からない」） */
export function screenChoice(given: string | null | undefined): ReportScreen {
  const s = (given ?? "").normalize("NFKC").replace(/\s+/g, "");
  if (s === "") return "その他・分からない";
  const exact = REPORT_SCREENS.find((x) => x.replace(/\s+/g, "") === s);
  if (exact !== undefined) return exact;
  const rules: [RegExp, ReportScreen][] = [
    [/ヒアリング|URL/i, "URL で答えるヒアリング"],
    [/AI|接続/i, "AI 接続"],
    [/資産と負債|バランスシート|BS/i, "資産と負債"],
    [/万一|もしも/, "万一のとき"],
    [/提案書|PDF|レポート/i, "提案書"],
    [/事務所|設定|保存|復元キー|同期/, "事務所の設定・保存"],
    [/結果|キャッシュフロー|グラフ|プラン|対策/, "結果"],
    [/入力/, "入力"],
  ];
  return rules.find(([re]) => re.test(s))?.[1] ?? "その他・分からない";
}

/** 件の種類（受け付けのフォームの「どれに当たりますか」と同じ3つ。接続口の kind） */
export type ReportKind = "bug" | "request" | "question";
export const REPORT_KINDS: readonly ReportKind[] = ["bug", "request", "question"];
export const KIND_LABEL: Record<ReportKind, string> = { bug: "不具合", request: "要望", question: "質問" };

/** 送る報告の1件（FP が確かめて直した後） */
export interface ReportItem {
  kind: ReportKind;
  /** どの画面のことか */
  screen: ReportScreen;
  /** 内容 */
  text: string;
}

/** AI が書いた件を、確認画面の件にそろえる（知らない種類は不具合、画面は選択肢に寄せる） */
export function itemFromAi(v: { kind?: string | null; screen?: string | null; text?: string | null }): ReportItem {
  const kind = REPORT_KINDS.find((k) => k === v.kind) ?? "bug";
  return { kind, screen: screenChoice(v.screen), text: v.text ?? "" };
}

/** 送る報告（送る報告の確認画面の中身。1回に何件か） */
export interface ReportDraft {
  /** 受付番号（1回の送りに1つ） */
  code: string;
  items: readonly ReportItem[];
  appVersion: string;
  os: string;
  /** AI がまとめた報告か（フォームに via=ai を付ける） */
  viaAi: boolean;
}

/** 送れるか（件が1つ以上あり、どの件の内容も空でない。空の報告・空の件は送れない） */
export function canSend(items: readonly ReportItem[]): boolean {
  return items.length > 0 && items.every((i) => i.text.trim() !== "");
}

/**
 * クリップボードに写す文（フォームの内容の欄に貼る物）。頭に受付番号・版と OS・件数を付け、件ごとに番号・種類・どの画面かの見出しを付ける。
 * フォームの「どれに当たりますか」「どの画面のことですか」は1つしか選べないので、件ごとの種類と画面は本文に書く（2件以上は「どれに当たりますか」で「いくつか（まとめて）」を選んでもらう）
 */
export function composeReport(d: ReportDraft): string {
  const n = d.items.length;
  const head = [`受付番号: ${d.code}`, `アプリの版: ${d.appVersion}（${d.os}）`, `件数: ${n}件${d.viaAi ? "（AI がまとめ、FP が確かめて送りました）" : ""}`];
  const body = d.items.map((it, i) => [`━━ ${i + 1}件目／${n}件（${KIND_LABEL[it.kind]}）どの画面か: ${it.screen} ━━`, it.text.trim()].join("\n"));
  return [...head, "", body.join("\n\n")].join("\n");
}

/** 受け付けのフォームの「どれに当たりますか」で、2件以上をまとめて送るときに選ぶ選択肢（利用者の判断。0259 の追記） */
export const FORM_KIND_MANY = "いくつか（まとめて）";

/** フォームの「どれに当たりますか」の案内（2件以上は「いくつか（まとめて）」、1件はその件の種類） */
export function formKindGuide(items: readonly ReportItem[]): string {
  const one = items.length === 1 ? items[0] : undefined;
  return `フォームの「どれに当たりますか」は「${one !== undefined ? KIND_LABEL[one.kind] : FORM_KIND_MANY}」を選んでください。`;
}

/** 送り方の道具（本体の命令。開発用のサーバーでは代わりの物） */
export interface ReportSendDeps {
  /** 文をクリップボードに写す（写せたら true） */
  copy: (text: string) => Promise<boolean>;
  /** フォームを既定のブラウザで開く（受付番号と AI 経由の印だけ。開けなければ投げる） */
  openForm: (code: string, via: "ai" | undefined) => Promise<void>;
  /** 受付番号をこの PC に覚える */
  remember: (r: Receipt) => void;
  /** 今日（YYYY-MM-DD） */
  today: () => string;
}

/** 送った結果 */
export interface ReportSendResult {
  /** 写した文（写せなかったときに選んで写してもらう） */
  text: string;
  copied: boolean;
  opened: boolean;
  /** フォームの「どれに当たりますか」の案内（formKindGuide） */
  kindGuide: string;
}

/**
 * 送る（1か所）: 全件を1つの文にまとめて写し、受付番号を覚えて、フォームを1回だけ開く。報告の文は URL に入れない。
 * 写せなくてもフォームは開き、文を選んで写してもらう。空の報告・空の件は送らない（投げる）。
 * 自前の受け付けができたら、ここを「文を直接送る」形に替える（写す・開くは要らなくなる）
 */
export async function sendReport(d: ReportDraft, deps: ReportSendDeps): Promise<ReportSendResult> {
  if (!canSend(d.items)) throw new Error("E_REPORT_EMPTY");
  const text = composeReport(d);
  const copied = await deps.copy(text).catch(() => false);
  deps.remember({ code: d.code, on: deps.today() });
  let opened = true;
  try {
    await deps.openForm(d.code, d.viaAi ? "ai" : undefined);
  } catch {
    opened = false;
  }
  return { text, copied, opened, kindGuide: formKindGuide(d.items) };
}
