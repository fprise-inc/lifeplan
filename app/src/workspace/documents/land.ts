// 土地・建物の書類の読み取り（0235）: 固定資産税の課税明細書と路線価図（国税庁）から、相続税の試算の不動産ごとの欄（0231 の lands[]）に入る値を整える。
// - 課税明細書: 地積（㎡）・土地の価格（固定資産税評価額）・家屋の価格。課税標準額・税額は相続税の評価に使わないので、その見出しの候補は読まない
// - 路線価図: 路線価図の記号のまま（例「250C」）受け取り、読み口が「土地の評価の入れ方」（路線価×面積）・路線価（千円単位 → 円）・借地権割合（A〜G）に分ける
// - 入れ先の不動産は FP が選ぶ（書類の土地のまとまり〔land:site〕を、今ある持ち家・住まい以外の不動産のどれかに入れる。新しく足さない）
// - 読む・残すのは計算に使う数だけ。所有者・納税義務者の名前・住所・番号、土地・家屋の所在（地番）、路線価図の図の番号・地名は読まない（0231 の欄に無い）
import { isDetailed, landTargets } from "../input/inheritanceLand.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { MASK } from "../../../../statement/src/index.ts";
import { LAND_ITEM, type CandidateTarget, type CandidateValue, type DocSource, type DocType } from "./types.ts";

/** 借地権割合の記号と割合（国税庁の路線価図の決まり。A 90%〜G 30%） */
export const LEASEHOLD_RATIOS: Readonly<Record<LeaseholdMark, number>> = { A: 90, B: 80, C: 70, D: 60, E: 50, F: 40, G: 30 };
export type LeaseholdMark = "A" | "B" | "C" | "D" | "E" | "F" | "G";

/** 書類の土地のまとまり（課税明細書の同じ敷地の筆と家屋・路線価図の1つの土地）の物の種類。今ある不動産に入れるだけで、新しく足さない */
export const LAND_OBJECT_KIND = "land:site";

/** 路線価の上限（千円単位。最も高い路線価でも数万千円なので、これを超える数は読み違いとみなす） */
const ROUTE_MAX_THOUSANDS = 999_999;

/**
 * 路線価図の記号を読む（例「250C」→ 1㎡あたり 250,000円・借地権割合 C）。全角・小文字・前後の空白・桁区切り・「千円」を許す。
 * 数は千円単位（路線価図の決まり）。記号の無い路線価（借地権割合の記号が読めない）は ratio を null にする。読めなければ null
 */
export function parseRouteMark(raw: string): { yen: number; ratio: LeaseholdMark | null } | null {
  const s = raw.normalize("NFKC").replace(/[\s,]/gu, "").replace(/千円/u, "").toUpperCase();
  const m = /^([0-9]{1,6})([A-G])?$/u.exec(s);
  if (m === null) return null;
  const n = Number(m[1]);
  if (!(n > 0) || n > ROUTE_MAX_THOUSANDS) return null;
  return { yen: n * 1000, ratio: (m[2] as LeaseholdMark | undefined) ?? null };
}

/** 地積を ㎡ の10進の文字にする（小数2桁まで。3桁目からは切り捨て。0231 の landArea の形）。読めなければ null */
export function normalizeArea(v: CandidateValue): { text: string; truncated: boolean } | null {
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "string" ? v.normalize("NFKC").replace(/[\s,]/gu, "").replace(/(㎡|m2|m²|平方メートル)$/u, "") : "";
  const m = /^([0-9]{1,7})(?:\.([0-9]+))?$/u.exec(s);
  if (m === null) return null;
  const int = String(Number(m[1]));
  const frac = (m[2] ?? "").replace(/0+$/u, "");
  const kept = frac.slice(0, 2);
  const text = kept === "" ? int : `${int}.${kept}`;
  if (!(Number(text) > 0)) return null;
  return { text, truncated: frac.length > 2 };
}

/** 円の額（課税明細書の価格）を円の整数にする（全角・桁区切り・「円」を許す。0 も読む）。読めなければ null */
export function normalizeYen(v: CandidateValue): number | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.normalize("NFKC").replace(/[\s,]/gu, "").replace(/円$/u, "");
  return /^[0-9]{1,13}$/u.test(s) ? Number(s) : null;
}

/**
 * 計算に使わない個人の情報の見出し（課税明細書の所有者・納税義務者・所在・地番・家屋番号・通知書の番号など。この見出しの候補は読まずに落とす）。
 * 番号の見出し（privacy.ts の NUMBER_FIELD_WORDS）は、どの書類でも落とす
 */
export const PLACE_FIELD_WORDS = /(所在|地番|家屋番号|所有者|納税義務者|納税者|宛名|住所|氏名|名称|共有者|通知書番号|物件番号|図番|地図番号)/u;

/** 所在・地番らしい文字（「123番4」「12番地の3」「1丁目2番3号」）。土地・建物の書類の文字の中で伏せる */
const PLACE_TEXT = /[0-9]+(?:丁目|番地?)(?:[-‐－の]?[0-9]+(?:番地?|号)?)*/gu;

/** 文字の中の所在・地番らしい所を伏せる（masked は伏せたか） */
export function maskPlace(text: string): { text: string; masked: boolean } {
  let masked = false;
  const out = text.normalize("NFKC").replace(PLACE_TEXT, () => {
    masked = true;
    return MASK;
  });
  return { text: masked ? out : text, masked };
}

/** 元の場所の文字の所在・地番らしい所を伏せる（伏せた数を返す） */
export function maskPlaceSource(src: DocSource): number {
  let n = 0;
  for (const k of ["where", "text"] as const) {
    const v = src[k];
    if (v === undefined) continue;
    const m = maskPlace(v);
    if (m.masked) {
      src[k] = m.text;
      n++;
    }
  }
  return n;
}

/** 相続税の評価に使わない額の見出し（課税標準額・税額・負担調整。価格〔評価額〕と取り違えやすい） */
export const NOT_VALUE_WORDS = /(課税標準|税額|負担調整|負担水準|軽減)/u;

/** 書類の種類ごとに受ける場所か（at は ["lands", <名前>]） */
export function landAtOk(docType: DocType, at: readonly string[] | undefined, names: readonly string[]): boolean {
  if (docType === "insurancePolicy") return false;
  return at !== undefined && at.length === 2 && at[0] === "lands" && names.includes(at[1] as string);
}

/** 土地の欄の名前（候補の場所の2つ目） */
export const landName = (t: Pick<CandidateTarget, "item" | "at">): string | null => (t.item === LAND_ITEM && t.at?.[0] === "lands" && t.at.length === 2 ? (t.at[1] as string) : null);

/** 書類の土地を入れられる今ある不動産（持ち家・住まい以外の不動産。相続税の試算の対象と同じ並び） */
export const landLinkTargets = (wh: WorkingHousehold): { id: string; label: string }[] => landTargets(wh.request.input.household).map((t) => ({ id: t.object, label: t.title }));

const METHOD_FOR: Readonly<Record<string, string>> = {
  routePrice: "「土地の評価の入れ方」を「路線価×面積（路線価地域）」にすると入れられます（この書類の「土地の評価の入れ方」の行を先に承認してください）",
  fixedValue: "「土地の評価の入れ方」を「固定資産税評価額×倍率（倍率地域）」か「固定資産税評価額から推定（×8/7）」にすると入れられます（入力の「相続税の試算」で選びます）",
};

/**
 * 土地の欄が無いときの理由（「この世帯に、この値を入れる欄がありません」より詳しく。相続税も試算するか・評価の入れ方・不動産の種類で決まる欄なので）
 */
export function landMissingReason(wh: WorkingHousehold, name: string, object: string | null): string {
  if (!isDetailed(wh)) return "相続・贈与の入力項目の「相続税も試算する（土地の評価・小規模宅地等の特例）」にチェックすると入れられます";
  const t = landTargets(wh.request.input.household);
  if (t.length === 0) return "持ち家・住まい以外の不動産がありません。不動産を入れると入れられます";
  const target = object === null ? null : t.find((x) => x.object === object);
  if (object !== null && target === undefined) return "入れる不動産がこの世帯にありません";
  if (name in METHOD_FOR) return METHOD_FOR[name] as string;
  if (name === "leaseholdRatio") return "借地権割合は、貸している物件だけに入れます（貸家建付地の減額に使います）。自宅などの土地では使いません";
  if (name === "buildingValue") return "この不動産には建物の欄がありません（貸していない土地だけの不動産など）";
  return "この世帯に、この値を入れる欄がありません";
}
