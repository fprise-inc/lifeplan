// バランスシートの図の分け方（アプリの「資産と負債」のタブと、提案書のバランスシートの図で同じ決まりを使う）。
// - 資産は使いやすさで4つに分ける: すぐ使えるお金（預金など）／値動きのある運用（NISA・課税口座など）／
//   引き出せないお金（iDeCo・企業型DC など）／換金しにくい資産（不動産・車・保険の解約返戻金・その他の資産）。上の3つが金融資産。
// - 負債は住宅ローンと、その他の負債（車のローン・奨学金・その他の借入、金融資産が尽きた後の「資金の不足」）。
// - 金融資産の器のマイナス（決済口座の不足）は、資産から外して負債の側の「資金の不足」に置く。
// - 不動産は土地と建物の項目に分ける（エンジンの cf.balance.account.realEstate.land・.building。持ち家と、中身を入れた住まい以外の不動産の合計）。
//   土地と建物に分けていない不動産（中身の無い不動産の器）は「その他の不動産」。建物は年数とともに減り、土地は残る（0028）。
// - 住まい以外の不動産のローン（負債の property）は「不動産のローン」。
// - 資産の合計＝負債の合計＋純資産（純資産は資産の合計−負債の合計で出すので、どの年も必ず合う）。
// 計算はしない（エンジンの表のマスを年ごとに分けて足すだけ。円の整数のまま）
import type { TableCell } from "./bundle.ts";

export type Yen = number;

/** 資産の4つの分け方と、負債の2つの分け方 */
export type BsGroup = "liquid" | "market" | "locked" | "illiquid" | "mortgage" | "debt";

export const BS_ASSET_GROUPS: readonly BsGroup[] = ["liquid", "market", "locked", "illiquid"];
export const BS_DEBT_GROUPS: readonly BsGroup[] = ["mortgage", "debt"];
/** 金融資産に入る分け方 */
export const BS_FINANCIAL_GROUPS: readonly BsGroup[] = ["liquid", "market", "locked"];

export const BS_GROUP_LABEL: Record<BsGroup, string> = {
  liquid: "すぐ使えるお金",
  market: "値動きのある運用",
  locked: "引き出せないお金",
  illiquid: "換金しにくい資産",
  mortgage: "住宅ローン",
  debt: "その他の負債",
};

/** 短い名前（並べて小さく見せるとき） */
export const BS_GROUP_SHORT: Record<BsGroup, string> = {
  liquid: "すぐ使える",
  market: "値動きあり",
  locked: "引き出せない",
  illiquid: "換金しにくい",
  mortgage: "住宅ローン",
  debt: "その他の負債",
};

/** 1つの箱の中の項目（例: 預金・NISA・持ち家（土地・建物）・資金の不足） */
export interface BsLine {
  key: string;
  label: string;
  group: BsGroup;
  amount: Yen;
}

/** その年の年末のバランスシート */
export interface BsAt {
  year: number;
  /** 0 より大きい項目だけ（分け方の順・分け方の中の決まった順） */
  lines: BsLine[];
  totalAssets: Yen;
  /** 負債の合計（資金の不足を含む） */
  totalLiabilities: Yen;
  netWorth: Yen;
  /** 金融資産（すぐ使える・値動きあり・引き出せないの合計。0以上） */
  financial: Yen;
  /** 資金の不足（金融資産の器のマイナスの合計。0以上） */
  shortfall: Yen;
}

/** 世帯のうち、項目の名前を決めるのに使うところ（負債の種類と、住まい以外の不動産のローンか。ID は画面・帳票に出さない） */
export interface BsHousehold {
  residences?: readonly { id: string }[];
  debts?: readonly { id: string; kind: string; property?: string }[];
}

/** 器の種類 → 分け方・項目の鍵・名前（並びは箱の中の上からの順） */
const ACCOUNT: readonly { kinds: readonly string[]; group: BsGroup; key: string; label: string }[] = [
  { kinds: ["deposit"], group: "liquid", key: "deposit", label: "預金" },
  { kinds: ["zaikei"], group: "liquid", key: "zaikei", label: "財形貯蓄" },
  { kinds: ["nisa", "legacyNisa"], group: "market", key: "nisa", label: "NISA" },
  { kinds: ["childNisa", "juniorNisa"], group: "market", key: "childNisa", label: "子どものNISA" },
  { kinds: ["taxable"], group: "market", key: "taxable", label: "課税口座" },
  { kinds: ["fxDeposit"], group: "market", key: "fxDeposit", label: "外貨預金" },
  { kinds: ["esop"], group: "market", key: "esop", label: "持株会" },
  { kinds: ["pooled"], group: "market", key: "pooled", label: "まとめた金融資産" },
  { kinds: ["ideco"], group: "locked", key: "ideco", label: "iDeCo" },
  { kinds: ["corporateDc"], group: "locked", key: "corporateDc", label: "企業型DC" },
  { kinds: ["smallBusinessMutualAid"], group: "locked", key: "mutualAid", label: "小規模企業共済" },
];
/** 金融資産に入らない器（換金しにくい資産） */
const ILLIQUID: readonly { kind: string; key: string; label: string }[] = [
  { kind: "car", key: "car", label: "車" },
  { kind: "insurance", key: "insurance", label: "保険の解約返戻金" },
  { kind: "otherAsset", key: "otherAsset", label: "その他の資産" },
];
const NON_FINANCIAL = new Set(["realEstate", ...ILLIQUID.map((x) => x.kind)]);
const DEBT_LABEL: Record<string, { key: string; label: string }> = {
  property: { key: "propertyLoan", label: "不動産のローン" },
  car: { key: "carLoan", label: "車のローン" },
  scholarship: { key: "scholarship", label: "奨学金" },
};

const ACCOUNT_PREFIX = "cf.balance.account.";

/** 項目の並び（箱の中の上から）: 分け方の順、分け方の中は決めた順 */
const ORDER: readonly string[] = [
  ...ACCOUNT.map((x) => x.key),
  "finOther",
  "land",
  "building",
  "realEstateOther",
  ...ILLIQUID.map((x) => x.key),
  "mortgage",
  "propertyLoan",
  "carLoan",
  "scholarship",
  "debtOther",
  "short",
];

/** 年ごとのバランスシート（years の並び） */
export function bsSeries(table: readonly TableCell[], years: readonly number[], household: BsHousehold): BsAt[] {
  const debtKind = new Map((household.debts ?? []).map((d) => [d.id, d.property !== undefined ? "property" : d.kind]));
  const index = new Map(years.map((y, i) => [y, i]));
  // 年ごと: 項目の鍵 → 額（金融資産の器は器の種類ごとに足してから、マイナスを資金の不足へ回す）
  const fin: Map<string, number>[] = years.map(() => new Map());
  const other: Map<string, number>[] = years.map(() => new Map());
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const c of table) {
    const i = index.get(c.year);
    if (i === undefined) continue;
    if (c.row.startsWith(ACCOUNT_PREFIX)) {
      const kind = c.row.slice(ACCOUNT_PREFIX.length);
      if (kind === "realEstate.land") add(other[i] as Map<string, number>, "land", c.amount);
      else if (kind === "realEstate.building") add(other[i] as Map<string, number>, "building", c.amount);
      else if (kind === "realEstate" || kind.startsWith("realEstate.")) add(other[i] as Map<string, number>, "realEstateOther", c.amount);
      else if (NON_FINANCIAL.has(kind)) add(other[i] as Map<string, number>, ILLIQUID.find((x) => x.kind === kind)?.key ?? "otherAsset", c.amount);
      else add(fin[i] as Map<string, number>, kind, c.amount);
    } else if (c.row === "cf.balance.debt.mortgage" || c.row === "cf.balance.debt.unpaidInterest") add(other[i] as Map<string, number>, "mortgage", c.amount);
    else if (c.row === "cf.balance.debt.other") add(other[i] as Map<string, number>, DEBT_LABEL[(c.object !== undefined ? debtKind.get(c.object) : undefined) ?? ""]?.key ?? "debtOther", c.amount);
  }
  return years.map((year, i) => {
    const amounts = new Map<string, number>();
    let shortfall = 0;
    for (const [kind, v] of fin[i] as Map<string, number>) {
      if (v < 0) {
        shortfall += -v;
        continue;
      }
      add(amounts, ACCOUNT.find((x) => x.kinds.includes(kind))?.key ?? "finOther", v);
    }
    for (const [k, v] of other[i] as Map<string, number>) add(amounts, k, v);
    if (shortfall > 0) amounts.set("short", shortfall);
    const lines: BsLine[] = [];
    for (const key of ORDER) {
      const v = amounts.get(key) ?? 0;
      if (v > 0) lines.push({ key, label: lineLabel(key), group: groupOf(key), amount: v });
    }
    const sum = (gs: readonly BsGroup[]) => lines.filter((l) => gs.includes(l.group)).reduce((s, l) => s + l.amount, 0);
    const totalAssets = sum(BS_ASSET_GROUPS);
    const totalLiabilities = sum(BS_DEBT_GROUPS);
    return { year, lines, totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities, financial: sum(BS_FINANCIAL_GROUPS), shortfall };
  });
}

/** 不動産の項目（土地・建物・その他の不動産） */
export const BS_REAL_ESTATE_KEYS: readonly string[] = ["land", "building", "realEstateOther"];

/** 分け方ごとの合計 */
export function groupTotal(at: BsAt, g: BsGroup): Yen {
  return at.lines.reduce((s, l) => (l.group === g ? s + l.amount : s), 0);
}

function lineLabel(key: string): string {
  const a = ACCOUNT.find((x) => x.key === key);
  if (a !== undefined) return a.label;
  const o = ILLIQUID.find((x) => x.key === key);
  if (o !== undefined) return o.label;
  const d = Object.values(DEBT_LABEL).find((x) => x.key === key);
  if (d !== undefined) return d.label;
  return (
    {
      finOther: "その他の金融資産",
      land: "土地",
      building: "建物",
      realEstateOther: "その他の不動産",
      mortgage: "住宅ローン",
      debtOther: "その他の借入",
      short: "資金の不足",
    } as Record<string, string>
  )[key] as string;
}

function groupOf(key: string): BsGroup {
  const a = ACCOUNT.find((x) => x.key === key);
  if (a !== undefined) return a.group;
  if (key === "finOther") return "liquid";
  if (key === "mortgage") return "mortgage";
  if (key === "propertyLoan" || key === "carLoan" || key === "scholarship" || key === "debtOther" || key === "short") return "debt";
  return "illiquid";
}
