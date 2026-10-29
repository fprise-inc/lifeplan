// 万一の前提の入力項目ID と当て先（0071）。万一の前提は世帯に1つ（全プラン共通）で、プランごとに変えたい値だけを、向き先
// {plan: "contingency"}・入力項目ID（contingencyPremise.*。app/schemas/household.contingency.json の x-item）・その値の中の場所 at の
// 値を変える差分（0036 の2）で上書きする。ここは差分を読み書きする決まりだけを持つ（プランの一覧・画面は知らない）
import { ITEM_PLACES } from "../../generated/readings.ts";
import type { Address } from "../store/readings.ts";
import type { ContingencyPlan } from "./planData.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** 万一の前提の区画の名前（登録簿の collection） */
export const PREMISE_SECTION = "contingencyPremise";

/** 前提の欄の名前 → 入力項目ID（登録簿から。場面・起きる年・重ねる印は ID を持たない＝差分にしない） */
export const PREMISE_ITEMS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ITEM_PLACES)
    .filter(([, p]) => p.collection === PREMISE_SECTION && p.status === "active")
    .map(([id, p]) => [p.path[0] as string, id]),
);

/** 前提の中の場所（["survivor", "livingRatio", "beforeIndependence"]）の当て先。ID を持たない欄（起きる年など）は null */
export function premiseAddress(path: readonly string[]): Address | null {
  const [head, ...at] = path;
  const item = head === undefined ? undefined : PREMISE_ITEMS[head];
  return item === undefined ? null : { target: { plan: "contingency" }, item, at };
}

/** 当て先 → 前提の中の場所 */
export function premisePath(a: { item: string; at: readonly string[] }): string[] | null {
  const place = ITEM_PLACES[a.item];
  if (place === undefined || place.collection !== PREMISE_SECTION) return null;
  return [...place.path, ...a.at];
}

export function readPath(o: unknown, path: readonly string[]): unknown {
  let cur = o;
  for (const k of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** 前提に値を書く（undefined は省く＝既定に戻す。空になった入れ物も外す。survivor・work・oldAgeChoice の入れ物は残す） */
export function writePath(plan: ContingencyPlan, path: readonly string[], value: unknown): void {
  const put = (o: Obj, rest: readonly string[]): void => {
    const [k, ...more] = rest;
    if (k === undefined) return;
    if (more.length === 0) {
      if (value === undefined) delete o[k];
      else o[k] = structuredClone(value);
      return;
    }
    let child = o[k];
    if (!isObj(child)) {
      if (value === undefined) return;
      child = {};
      o[k] = child;
    }
    put(child as Obj, more);
    if (value === undefined && Object.keys(child as Obj).length === 0) delete o[k];
  };
  put(plan as unknown as Obj, path);
  plan.survivor ??= {};
  plan.work ??= {};
  plan.oldAgeChoice ??= {};
}

/** 差分の値（値の箱）の中身。省いた（既定に戻した）値は null で持つ */
const unboxed = (v: unknown): unknown => (isObj(v) && "state" in v && isObj(v.origin) ? v.value : v);

interface PremiseDiff {
  op: string;
  target: unknown;
  item: string | null;
  at: readonly string[] | null;
  value: unknown;
  enabled: boolean;
  unresolved?: boolean;
}

/** 万一の前提の差分か */
export const isPremiseDiff = (d: { target: unknown }): boolean => isObj(d.target) && d.target.plan === "contingency";

/**
 * そのプランの万一の前提（0036 の6 の3）: 全プラン共通の前提の写しに、土台のいちばん下のプランから順に、オンの万一の前提の差分を当てる
 * （同じ場所は後のプランが勝つ）。起きる年・重ねる印は共通のまま
 */
export function applyPremiseDiffs(common: ContingencyPlan, plans: readonly { diffs: readonly PremiseDiff[] }[]): ContingencyPlan {
  const out = structuredClone(common);
  for (const p of plans)
    for (const d of p.diffs) {
      if (!d.enabled || d.unresolved === true || d.op !== "set" || !isPremiseDiff(d) || d.item === null || d.at === null) continue;
      const path = premisePath({ item: d.item, at: d.at });
      if (path === null) continue;
      const v = unboxed(d.value);
      writePath(out, path, v === null ? undefined : v);
    }
  return out;
}

// ---- 違いの一覧の言い方 ----

const PCT = (v: unknown) => `${Math.round(Number(v) * 1000) / 10}%`;
const YEN = (v: unknown) => `${(Number(v) / 10000).toLocaleString("en-US")}万円`;
const WORK: Readonly<Record<string, string>> = { keep: "今の働き方を続ける", regular: "正社員", contract: "契約社員", partTime: "パート", selfEmployed: "自営業", none: "働かない" };
const HORIZON: Readonly<Record<string, string>> = { lifeExpectancy: "配偶者の平均余命まで（配偶者がいなければ末子の独立まで）", youngestIndependence: "末子の独立まで", age: "配偶者が決めた年齢まで" };
const METHOD: Readonly<Record<string, string>> = { accumulation: "積み上げ方式", reverse: "逆算方式" };
const WHO: Readonly<Record<string, string>> = { self: "本人", spouse: "配偶者", both: "本人と配偶者" };

/** 場所の型（構成員の ID は * にする）→ 名前と値の言い方 */
const LABELS: readonly { at: string; label: string; text?: (v: unknown) => string }[] = [
  { at: "survivor/livingRatio/beforeIndependence", label: "遺族の生活費（子がいる間）", text: PCT },
  { at: "survivor/livingRatio/afterIndependence", label: "遺族の生活費（末子の独立の後）", text: PCT },
  { at: "survivor/livingRatio/noChildren", label: "遺族の生活費（子がいない世帯）", text: PCT },
  { at: "survivor/independenceAge", label: "子の独立とみなす年齢", text: (v) => `${String(v)}歳` },
  { at: "survivor/funeral", label: "整理資金", text: YEN },
  { at: "survivor/reserveMonths", label: "予備の生活資金", text: (v) => `${String(v)}か月分` },
  { at: "survivor/deathBenefits/retirementAllowance", label: "死亡退職金", text: YEN },
  { at: "survivor/deathBenefits/condolence", label: "弔慰金", text: YEN },
  { at: "survivor/deathBenefits/workRelated", label: "業務上の死亡", text: (v) => (v === true ? "はい" : "いいえ") },
  { at: "horizon/kind", label: "必要保障額の期間", text: (v) => HORIZON[String(v)] ?? String(v) },
  { at: "horizon/age", label: "必要保障額の期間（配偶者の年齢）", text: (v) => `${String(v)}歳` },
  { at: "protection/method", label: "必要保障額の出し方", text: (v) => METHOD[String(v)] ?? String(v) },
  { at: "protection/reverseUntilAge", label: "逆算: 資産が尽きないようにする遺族の年齢", text: (v) => `${String(v)}歳` },
  { at: "work/*/type", label: "残された配偶者の働き方", text: (v) => WORK[String(v)] ?? String(v) },
  { at: "work/*/annualSalary", label: "残された配偶者の年収", text: YEN },
  { at: "work/*/afterMonths", label: "働き方を変える時期", text: (v) => `亡くなってから${String(v)}か月後` },
  { at: "work/*/from", label: "働き方を変える時期", text: () => "時点で指定" },
  { at: "work/*/untilAge", label: "残された配偶者が働く年齢", text: (v) => `${String(v)}歳まで` },
  ...(["disability", "income"] as const).flatMap((scene) => {
    const pre = scene === "disability" ? "就業不能のときの配偶者" : "収入が減るときの配偶者";
    return [
      { at: `partnerWork/${scene}/*/type`, label: `${pre}の働き方`, text: (v: unknown) => WORK[String(v)] ?? String(v) },
      { at: `partnerWork/${scene}/*/annualSalary`, label: `${pre}の年収`, text: YEN },
      { at: `partnerWork/${scene}/*/afterMonths`, label: `${pre}の働き方を変える時期`, text: (v: unknown) => `${scene === "disability" ? "働けなくなってから" : "減り始めてから"}${String(v)}か月後` },
      { at: `partnerWork/${scene}/*/from`, label: `${pre}の働き方を変える時期`, text: () => "時点で指定" },
      { at: `partnerWork/${scene}/*/untilAge`, label: `${pre}が働く年齢`, text: (v: unknown) => `${String(v)}歳まで` },
    ];
  }),
  { at: "grade", label: "就業不能・障害の仮定の等級", text: (v) => (Number(v) === 0 ? "障害年金に当たらない" : `${String(v)}級`) },
  { at: "medical/monthly", label: "就業不能・障害の医療費（1か月）", text: YEN },
  { at: "medical/months", label: "就業不能・障害の医療費の月数", text: (v) => `${String(v)}か月` },
  { at: "oldAgeChoice/*", label: "65歳からの障害年金と老齢年金の組み合わせ" },
  { at: "illness/months", label: "大きな病気の働けない期間", text: (v) => `${String(v)}か月` },
  { at: "illness/medicalMonthly", label: "大きな病気の医療費（1か月）", text: YEN },
  { at: "illness/medicalMonths", label: "大きな病気の医療費の月数", text: (v) => `${String(v)}か月` },
  { at: "illness/disease", label: "大きな病気の種類", text: (v) => ({ cancer: "がん", heartStroke: "心疾患・脳卒中", other: "そのほか" })[String(v)] ?? String(v) },
  { at: "illness/hospitalDays", label: "大きな病気の入院の日数", text: (v) => `${String(v)}日` },
  { at: "illness/surgeries", label: "大きな病気の手術の回数", text: (v) => `${String(v)}回` },
  { at: "illness/afterMonths", label: "復帰の後に収入が減る期間", text: (v) => `${String(v)}か月` },
  { at: "illness/afterRatio", label: "復帰の後の収入の割合", text: PCT },
  { at: "incomeDrop/member", label: "収入が減る人", text: (v) => WHO[String(v)] ?? String(v) },
  { at: "incomeDrop/ratio", label: "収入が減る割合", text: PCT },
  { at: "incomeDrop/years", label: "収入が減る年数", text: (v) => `${String(v)}年` },
  { at: "market/drop", label: "相場の下がる幅", text: (v) => `${Math.round(Number(v) * 10)}割` },
  { at: "market/classes", label: "相場の下落で下げる資産", text: (v) => (Array.isArray(v) ? `${v.length}種類` : "—") },
  { at: "market/recoveryYears", label: "下がった後の利回りを抑える年数", text: (v) => `${String(v)}年` },
  { at: "market/recoveryCap", label: "下がった後の利回りの上限", text: PCT },
];

/** 場所の型（構成員の ID などの乱数は *） */
const shape = (path: readonly string[]): string => path.map((k) => (/^[0-9a-f]{8}-/.test(k) ? "*" : k)).join("/");

/** 違いの一覧の名前と値の言い方（知らない場所は登録簿の名前） */
export function premiseText(path: readonly string[], v: unknown): { label: string; text: string } {
  const hit = LABELS.find((l) => l.at === shape(path));
  const text = v === undefined || v === null ? "既定" : hit?.text !== undefined ? hit.text(v) : typeof v === "string" ? v : JSON.stringify(v);
  return { label: hit?.label ?? path.join("・"), text };
}
