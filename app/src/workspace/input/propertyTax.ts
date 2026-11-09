// 固定資産税・都市計画税の推定（0112）: 購入の予定の持ち家で、固定資産税の欄が推定のままのとき、物件の価格・土地の割合・建物の構造・
// 購入の種類（新築か中古か・戸建てかマンションか）・長期優良住宅かから、最初の年の額と「固定資産税の変化」の段を推定で入れる。
// - 最初の年の額（固定資産税の欄）: 土地と建物の評価額（価格×割合の目安）に、住宅用地の特例・新築の軽減・税率を当てた額
// - 変化の段（今の額に対する割合の段）: 新築の軽減が終わる年に上がる段と、3年ごとの評価替えで建物の分が古くなった分だけ下がる段（下限で止まる）。
//   土地の分は横ばい
// - 推定のままの値だけ入れ直す（refreshEstimates から）。FP が固定資産税の欄に額（納税通知書の額など）を入れたら、その額を元にし、
//   推定の段（割合）は入れ直し続ける。FP が直した段・足した段は変えない。FP が外した推定の段は覚えて足し直さない（基本生活費の推定の段と同じ決まり）
// - 目安の割合（評価額の割合・都市計画税の税率）は事務所の推定の値（hearing/src/presets.ts）。法令で決まる値（税率・特例・軽減と、
//   固定資産評価基準の経年減点補正率・再建築費評点補正率）はここの PROPERTY_TAX_LAW・KEINEN に置き、事務所で変えられない
//   （docs/estimates-review.md の「一覧に入れていない値」）
// - 建物の下がり方（0181）: 固定資産評価基準の家屋の評価（評価額＝再建築費評点数×経年減点補正率）に寄せる。新築の評価額（経過年数1年の
//   補正率0.80を当てた後）を建物の価格×建物の評価額の割合とし、3年ごとの評価替えの年に、その年の経過年数の補正率に置き換え、
//   再建築費評点補正率（その評価替えの年の分。分かっている年だけ）を掛ける。上がる年は前の額のまま（在来分の家屋の価額の据え置き）
import type { AmountStage, Box, Debt, Household, Residence } from "../../engine/types.ts";
import { derivedId } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { presetNum } from "../../../../hearing/src/presets.ts";
import { putRow, rowAt, type StateRow } from "./rows.ts";
import { VALUATION_DEFAULTS } from "./labels.ts";
import { formatYen } from "./units.ts";

type Obj = Record<string, unknown>;

/**
 * 法令で決まる値（事務所で変えられない。法改正のときに直す）:
 * - 固定資産税の標準税率 1.4%（地方税法 第350条）。都市計画税の税率の上限 0.3%（第702条の4）
 * - 住宅用地の特例（小規模住宅用地。200㎡以下の部分）: 固定資産税の課税標準は評価額の6分の1（第349条の3の2）、都市計画税は3分の1（第702条の3）
 * - 新築住宅の減額: 建物の固定資産税を半分（120㎡までの部分）。戸建て3年・中高層の耐火のマンション5年（附則第15条の6）、
 *   認定長期優良住宅は戸建て5年・マンション7年（附則第15条の7）。制度の期限は延長を前提にする（見直しのたびに確かめる）
 * - 評価替えは3年ごと（基準年度。2024年度の次は2027年度。第341条第6号）
 */
export const PROPERTY_TAX_LAW = {
  standardRate: 0.014,
  cityPlanningCap: 0.003,
  landFixedShare: 1 / 6,
  landCityShare: 1 / 3,
  newRelief: 0.5,
  reliefYears: { house: 3, condo: 5, houseLongLife: 5, condoLongLife: 7 },
  reassessFrom: 2024,
  reassessEvery: 3,
} as const;

/** その年に効いている評価替えの年（基準年度） */
const reassessYear = (y: number): number => PROPERTY_TAX_LAW.reassessFrom + Math.floor((y - PROPERTY_TAX_LAW.reassessFrom) / PROPERTY_TAX_LAW.reassessEvery) * PROPERTY_TAX_LAW.reassessEvery;

/**
 * 固定資産評価基準（昭和38年自治省告示第158号。令和5年11月15日総務省告示第385号による改正後。令和6基準年度）の経年減点補正率（法令の値。0181）:
 * - 木造: 別表第9「木造家屋経年減点補正率基準表」1 専用住宅、共同住宅、寄宿舎及び併用住宅用建物 のうち、延べ床面積1.0㎡当たり再建築費評点数
 *   95,820点以上147,770点未満の区分（築25年で0.20）。新築の木造の戸建ての1㎡あたりの価格（総務省「固定資産の価格等の概要調書」令和6年度
 *   新増分家屋 木造 戸建形式住宅 87,664円。補正率0.80で割ると約109,600点）が入る区分を当てた（区分は家ごとの評点数で決まり、推定では分からない）
 * - 非木造: 別表第13「非木造家屋経年減点補正率基準表」2 住宅、アパート用建物。鉄筋コンクリート造（鉄骨鉄筋コンクリート造）60年・
 *   鉄骨造（骨格材の肉厚4mm超）40年・鉄骨造（3mm超4mm以下）30年で0.20。築3年まで0.80・0.75・0.70、その後は0.20までまっすぐ（小数4桁）。
 *   重量鉄骨造は4mm超、軽量鉄骨造は3mm超4mm以下とみなす
 * - 積雪地域・寒冷地域の補正（別表第9の2）は入れない
 */
const WOOD_KEINEN = [0.8, 0.75, 0.7, 0.68, 0.65, 0.63, 0.61, 0.59, 0.56, 0.54, 0.52, 0.5, 0.47, 0.45, 0.43, 0.4, 0.38, 0.36, 0.34, 0.31, 0.29, 0.27, 0.25, 0.22, 0.2] as const;
const NONWOOD_KEINEN_YEARS: Readonly<Record<string, number>> = { rc: 60, steel: 40, lightSteel: 30 };
export const KEINEN = { floor: 0.2, newRate: 0.8, wood: WOOD_KEINEN, nonWoodYears: NONWOOD_KEINEN_YEARS } as const;

/**
 * 再建築費評点補正率（固定資産評価基準 第2章第4節の経過措置。法令の値。0181）: 評価替えの年に、在来分の家屋の再建築費評点数に掛ける率。
 * 確かめた年だけ置く（令和6年度 木造1.11・非木造1.07。令和5年11月15日総務省告示第385号）。ほかの年（前の年と、まだ決まっていない
 * 2027年度から）は1（掛けない）
 */
export const REBUILD_FACTOR: Readonly<Record<number, { wood: number; nonWood: number }>> = { 2024: { wood: 1.11, nonWood: 1.07 } };

/** 建物の構造が木造か（軽量鉄骨造は非木造。固定資産評価基準の区分） */
const isWood = (structure: string): boolean => structure !== "rc" && structure !== "steel" && structure !== "lightSteel";

/** 経年減点補正率（経過年数。1年未満は1年の値。法令の値） */
export function keinenRate(structure: string, age: number): number {
  const a = Math.max(1, Math.floor(age));
  if (isWood(structure)) return WOOD_KEINEN[Math.min(a, WOOD_KEINEN.length) - 1]!;
  const n = NONWOOD_KEINEN_YEARS[structure] ?? 60;
  if (a <= 3) return [0.8, 0.75, 0.7][a - 1]!;
  if (a >= n) return KEINEN.floor;
  return Math.round((0.7 - ((0.7 - KEINEN.floor) * (a - 3)) / (n - 3)) * 10000) / 10000;
}

/** その評価替えの年の再建築費評点補正率（分からない年は1） */
export const rebuildFactor = (structure: string, year: number): number => {
  const f = REBUILD_FACTOR[year];
  return f === undefined ? 1 : isWood(structure) ? f.wood : f.nonWood;
};

/**
 * 建物の評価額の、時点の年（refYear）に効いている額に対する、その年（year）に効いている額の比（0181）。
 * 時点の年に効いている評価替えの年の経過年数の補正率を元に、その後の評価替えの年ごとに、経過年数の補正率×再建築費評点補正率（累積）に置き換え、
 * 前の額より上がる年は前の額のまま。経過年数は評価替えの年−建った年（1年未満は1年。新築の翌年の最初の評価と同じ0.80）
 */
export function buildingValueRatio(structure: string, built: number, refYear: number, year: number): number {
  const every = PROPERTY_TAX_LAW.reassessEvery;
  const rRef = reassessYear(refYear);
  const ageAt = (r: number): number => Math.max(1, r - built);
  const d0 = keinenRate(structure, ageAt(rRef));
  let v = d0;
  let cum = 1;
  for (let r = rRef + every; r <= reassessYear(year); r += every) {
    if (r <= built) continue;
    cum *= rebuildFactor(structure, r);
    v = Math.min(v, keinenRate(structure, ageAt(r)) * cum);
  }
  return v / d0;
}

/** 時点の年から段の最後の年までに、分かっている再建築費評点補正率が当たるか（根拠の文に書く） */
export function rebuildFactorNote(structure: string, built: number, refYear: number, lastYear: number): string | null {
  const every = PROPERTY_TAX_LAW.reassessEvery;
  const hits: string[] = [];
  for (let r = reassessYear(refYear) + every; r <= reassessYear(lastYear); r += every) {
    if (r <= built || REBUILD_FACTOR[r] === undefined) continue;
    hits.push(`${String(r)}年度${isWood(structure) ? "（木造" : "（非木造"}${String(rebuildFactor(structure, r))}倍）`);
  }
  return hits.length === 0 ? null : `再建築費評点補正率を${hits.join("・")}掛け、前の額より上がる年は前の額のまま`;
}

/** 評価替えの段の理由の文（築年数と経年減点補正率。下限なら止まると書く） */
export function reassessWhy(structure: string, y: number, built: number): string {
  const age = Math.max(1, y - built);
  const k = keinenRate(structure, age);
  return `${String(y)}年度の評価替えで、建物の評価額が築${String(age)}年の経年減点補正率（${String(k)}）まで下がる${k <= KEINEN.floor ? "（下限で止まる）" : ""}`;
}

/** 経年減点補正率の表の名前（根拠の文） */
export const keinenTableName = (structure: string): string =>
  isWood(structure) ? "木造の住宅・築25年で0.20" : `${structure === "rc" ? "鉄筋コンクリート造" : structure === "steel" ? "鉄骨造（肉厚4mm超）" : "鉄骨造（肉厚3〜4mm）"}の住宅・築${String(NONWOOD_KEINEN_YEARS[structure] ?? 60)}年で0.20`;

/** 推定の根拠の文の頭（この頭の推定を、固定資産税の推定の印として読む） */
export const PROPERTY_TAX_BASIS = "固定資産税の推定";
const METHOD = "derived";

/** 目安の割合（事務所の推定の値があればその値） */
const guide = {
  get landRatio(): number {
    return presetNum("preset.housing.propertyTax.landRatio");
  },
  get buildingRatio(): number {
    return presetNum("preset.housing.propertyTax.buildingRatio");
  },
  /** 都市計画税の税率（上限 0.3% を超えない） */
  get cityPlanningRate(): number {
    return Math.min(PROPERTY_TAX_LAW.cityPlanningCap, Math.max(0, presetNum("preset.housing.propertyTax.cityPlanningRate")));
  },
};

export interface PropertyTaxInputs {
  price: number;
  /** 土地の割合（物件の価格に対する） */
  landShare: number;
  /** 建物の構造（wood・lightSteel・steel・rc） */
  structure: string;
  condo: boolean;
  newBuild: boolean;
  /** 建物が建った年（中古で入れていなければ undefined） */
  builtYear?: number;
  purchaseYear: number;
  longLife: boolean;
  /** 注文住宅（土地を買って建てる。0115）。土地の割合は土地の代金から */
  custom?: boolean;
  /** 段を作る最後の年（住み終わりの年と計算の最後の年の早いほう） */
  lastYear: number;
}

export interface PropertyTaxStage {
  year: number;
  amount: number;
  /** 最初の年の額に対する割合（10進の文字） */
  ratio: string;
  basis: string;
}

export interface PropertyTaxPlan {
  /** 最初の年（購入の翌年。1月1日の持ち主にかかる）の額 */
  first: number;
  firstYear: number;
  basis: string;
  stages: PropertyTaxStage[];
}

const round100 = (v: number): number => Math.round(v / 100) * 100;
const pctOf = (r: number): string => `${String(Math.round(r * 100000) / 1000)}%`;
const manOf = (v: number): string => `${formatYen(Math.round(v / 10000) * 10000, "man")}万円`;
/** 推定で入れる段の割合（今の額に対する割合を小数1桁の％にそろえる。例 0.977＝97.7%。計算もこの値で） */
const ratioText = (r: number): string => {
  const t = (Math.round(r * 1000) / 1000).toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
  return t === "" ? "0" : t;
};
/** 割合の文字を％の文字に（0.977 → 97.7%） */
const ratioPct = (ratio: string): string => `${String(Math.round(Number(ratio) * 1000) / 10)}%`;
/** 今住んでいる持ち家の推定（ownedHomeTax.ts）が同じ目安・丸め・文の作りを使う */
export { guide as taxGuide, round100, pctOf, manOf, reassessYear, ratioText, ratioPct };

/** 新築の軽減の年数（購入の種類と長期優良住宅かから） */
export function reliefYears(condo: boolean, longLife: boolean): number {
  const y = PROPERTY_TAX_LAW.reliefYears;
  return condo ? (longLife ? y.condoLongLife : y.condo) : longLife ? y.houseLongLife : y.house;
}

/**
 * 推定の計算（純粋な関数）。土地の評価額 L＝価格×土地の割合×土地の評価額の割合、建物の評価額 B＝価格×(1−土地の割合)×建物の評価額の割合。
 * その年の税＝L×1/6×1.4%＋L×1/3×都市計画税率＋B(年)×1.4%×(新築の軽減の間は1/2)＋B(年)×都市計画税率。
 * B(年)＝B×buildingValueRatio(構造, 建った年, 最初の年, 年)（固定資産評価基準の経年減点補正率と再建築費評点補正率。0181）
 */
export function propertyTaxPlan(o: PropertyTaxInputs): PropertyTaxPlan {
  const law = PROPERTY_TAX_LAW;
  const cp = guide.cityPlanningRate;
  const land0 = o.price * o.landShare * guide.landRatio;
  const building0 = o.price * (1 - o.landShare) * guide.buildingRatio;
  const landTax = land0 * law.landFixedShare * law.standardRate + land0 * law.landCityShare * cp;
  // 建った年: 新築は入れた年か購入の年。中古で建った年が分からなければ購入の年に建ったとみなし、新築の軽減は当てない
  const known = o.builtYear !== undefined;
  const built = o.builtYear ?? o.purchaseYear;
  const relief = o.newBuild || known;
  const years = reliefYears(o.condo, o.longLife);
  const firstYear = o.purchaseYear + 1;
  const buildingIn = (y: number): number => building0 * buildingValueRatio(o.structure, built, firstYear, y);
  const inRelief = (y: number): boolean => relief && y >= built + 1 && y <= built + years;
  const taxIn = (y: number): number => {
    const b = buildingIn(y);
    return round100(landTax + b * law.standardRate * (inRelief(y) ? law.newRelief : 1) + b * cp);
  };
  const first = taxIn(firstYear);
  const kind = `${o.custom === true ? "注文住宅（新築の戸建て）" : `${o.newBuild ? "新築" : "中古"}の${o.condo ? "マンション" : "戸建て"}`}${o.longLife ? "（長期優良住宅）" : ""}`;
  const parts = [
    `${String(firstYear)}年の額`,
    o.custom === true ? `土地の代金${manOf(o.price * o.landShare)}・建物の代金${manOf(o.price * (1 - o.landShare))}・${kind}` : `物件の価格${manOf(o.price)}・土地の割合${pctOf(o.landShare)}・${kind}`,
    `評価額は土地が価格の${pctOf(guide.landRatio)}・建物が価格の${pctOf(guide.buildingRatio)}の目安で、建物は評価替えごとに固定資産評価基準の経年減点補正率（${keinenTableName(o.structure)}）で下げる`,
    `住宅用地の特例${inRelief(firstYear) ? `・新築の軽減（建物の分が半分。${String(years)}年）` : ""}を当て、都市計画税${pctOf(cp)}を含む`,
    ...(!o.newBuild && !known ? ["建った年が分からないので、建物は購入の年に建ったとみなした"] : []),
  ];
  const basis = `${PROPERTY_TAX_BASIS}（${parts.join("。")}）`;
  const stages: PropertyTaxStage[] = [];
  let prev = "1";
  for (let y = firstYear + 1; y <= o.lastYear; y++) {
    // 割合は小数1桁の％にそろえ、そろえた割合が前の段と同じ年は段にしない
    const ratio = first > 0 ? ratioText(taxIn(y) / first) : "1";
    if (ratio === prev) continue;
    const why: string[] = [];
    if (inRelief(y - 1) && !inRelief(y)) why.push("新築の軽減が終わり、建物の分が元に戻る");
    if (reassessYear(y) === y && buildingIn(y) !== buildingIn(y - 1)) why.push(reassessWhy(o.structure, y, built));
    // 根拠の文に割合を入れる（割合が変わったら文も変わる。値だけ変わって文が同じ行は、編集のときに「FP が直した」とみなして外されるため。rows.ts の dropStaleRows）
    stages.push({ year: y, amount: round100(first * Number(ratio)), ratio, basis: `${PROPERTY_TAX_BASIS}（${why.join("。") || "評価額の見直し"}。固定資産税の欄の額の${ratioPct(ratio)}）` });
    prev = ratio;
  }
  return { first, firstYear, basis, stages };
}

// ---- 世帯から推定の元を読む ----

/** 購入の月（購入の年月。省略は住み始め） */
const purchaseMonthOf = (h: Household, r: Residence): string | null => (r.purchase === undefined ? null : resolveTimepoint(h, r.purchase.at ?? r.from));

/** その購入の予定とつながる住まいの住宅ローン（控除の条件の住まいがその家か、借入の年月が購入の月） */
export function purchaseLoans(h: Household, r: Residence): Debt[] {
  // 注文住宅（0115）は土地の決済の月に借りるローン（土地先行融資）もつながる
  const months = [purchaseMonthOf(h, r), r.purchase?.land === undefined ? null : resolveTimepoint(h, r.purchase.land.at)].filter((x): x is string => x !== null);
  return (h.debts ?? []).filter((d) => d.kind === "mortgage" && d.property === undefined && (d.housing?.residence === r.id || months.includes(resolveTimepoint(h, d.start) ?? "")));
}

/** 長期優良住宅か: つながる住宅ローンに控除の条件があれば、住宅の種類が認定住宅か。無ければ住宅の購入の欄 */
export function longLifeOf(h: Household, r: Residence): boolean {
  const withCredit = purchaseLoans(h, r).filter((d) => d.housing !== undefined);
  if (withCredit.length > 0) return withCredit.some((d) => d.housing?.propertyType === "certified");
  return r.purchase?.longLife === true;
}

/** 推定の元（購入の予定の持ち家でなければ null） */
export function propertyTaxInputs(h: Household, r: Residence, endYear: number, landShareSetting?: string): PropertyTaxInputs | null {
  if (r.kind !== "own" || r.purchase === undefined) return null;
  const ym = purchaseMonthOf(h, r);
  if (ym === null) return null;
  const toYm = r.to === null ? null : resolveTimepoint(h, r.to);
  const style = r.style;
  const structure = r.valuation?.structure ?? (style === "condo" ? "rc" : "wood");
  const built = r.valuation?.builtYear;
  // 注文住宅（0115）は土地の代金から土地の割合を決める（計算エンジンの評価と同じ。土地と建物の評価額の目安をそれぞれの代金から）
  const land = r.purchase.land;
  const custom = land !== undefined && r.purchase.price > 0;
  return {
    price: r.purchase.price,
    landShare: custom ? Math.min(1, land.price / r.purchase.price) : Number(r.valuation?.landShare ?? landShareSetting ?? VALUATION_DEFAULTS.landShare),
    ...(custom ? { custom: true } : {}),
    structure,
    condo: style === "condo",
    newBuild: custom ? true : (r.purchase.newBuild ?? true),
    ...(built !== undefined ? { builtYear: built } : {}),
    purchaseYear: Number(ym.slice(0, 4)),
    longLife: longLifeOf(h, r),
    lastYear: Math.min(endYear, toYm === null ? endYear : Number(toYm.slice(0, 4))),
  };
}

// ---- 推定の印と入れ直し ----

const wrap = (h: Household): Obj => ({ household: h });
const ratioAddress = (rid: string, sid: string) => ({ target: { object: rid }, item: "residence.propertyTax", at: ["stages", sid, "ratio"] });
const dropAddress = (rid: string, sid: string) => ({ target: { object: rid }, item: "residence.propertyTax", at: ["stages", sid] });
const autoRow = (basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method: METHOD, basis } });
const isOurs = (basis: unknown): boolean => typeof basis === "string" && basis.startsWith(PROPERTY_TAX_BASIS);
const isAutoRowOurs = (r: StateRow | undefined): boolean => r?.state === "estimated" && r.origin.kind === "auto" && isOurs(r.estimate?.basis);

/** 固定資産税の欄が推定のまま（目安のボタンの値か、この推定）か */
export const isAutoTax = (b: Box<number> | undefined): boolean => b !== undefined && b.state === "estimated" && b.origin.kind === "auto";
/** 固定資産税の欄がこの推定のままか */
export const isEstimatedTax = (b: Box<number> | undefined): boolean => isAutoTax(b) && isOurs((b as { estimate?: { basis?: string } }).estimate?.basis);

/** 推定の段か（FP が直していない） */
export function isAutoTaxStage(h: Household, rid: string, sid: string): boolean {
  return isAutoRowOurs(rowAt(wrap(h), ratioAddress(rid, sid)));
}

/** 固定資産税の推定の段があるか（変動率の欄の知らせに使う） */
export function hasAutoTaxStages(h: Household, r: Residence): boolean {
  return (r.propertyTax?.stages ?? []).some((s) => isAutoTaxStage(h, r.id, s.id));
}

/** FP が外した推定の段を覚える（段はもう外した後でよい。推定の段でなければ何もしない） */
export function rememberDroppedTaxStage(h: Household, rid: string, sid: string): void {
  const input = wrap(h);
  if (!isAutoRowOurs(rowAt(input, ratioAddress(rid, sid)))) return;
  putRow(input, ratioAddress(rid, sid), undefined);
  putRow(input, dropAddress(rid, sid), { state: "notApplicable", origin: { kind: "manual" } });
}

/** 推定の段の ID（家と年から決める。入れ直しで同じ年の段は同じ ID） */
export const taxStageId = (rid: string, year: number): string => derivedId(rid, `propertyTax/${String(year)}`);

/**
 * 推定を入れる・入れ直す（h をそのまま書き換える）。start が true なら、固定資産税の欄が推定のまま（目安のボタンの値を含む）のときに入れる
 * （住宅の購入を足した・購入の種類を選んだとき）。start でなければ、この推定のままの欄と推定の段だけを入れ直す。変われば true
 */
export function applyPropertyTaxEstimate(h: Household, r: Residence, endYear: number, landShareSetting?: string, start = false): boolean {
  const o = propertyTaxInputs(h, r, endYear, landShareSetting);
  if (o === null || r.propertyTax === undefined) return false;
  const annual = r.propertyTax.annual;
  const stages: AmountStage[] = r.propertyTax.stages ?? [];
  const autoStage = (id: string | undefined): boolean => id !== undefined && isAutoTaxStage(h, r.id, id);
  const annualOurs = isEstimatedTax(annual) || (start && isAutoTax(annual));
  if (!annualOurs && !stages.some((s) => autoStage(s.id))) return false;
  const before = JSON.stringify(r);
  const plan = propertyTaxPlan(o);
  if (annualOurs) r.propertyTax.annual = { value: plan.first, state: "estimated", origin: { kind: "auto" }, estimate: { method: METHOD, basis: plan.basis } } as Box<number>;
  const input = wrap(h);
  const kept = stages.filter((s) => {
    if (!autoStage(s.id)) return true;
    putRow(input, ratioAddress(r.id, s.id), undefined);
    return false;
  });
  for (const s of plan.stages) {
    const id = taxStageId(r.id, s.year);
    if (kept.some((x) => x.id === id) || rowAt(input, dropAddress(r.id, id))?.state === "notApplicable") continue;
    kept.push({ id, at: { at: `${String(s.year)}-01` }, ratio: s.ratio });
    putRow(input, ratioAddress(r.id, id), autoRow(s.basis));
  }
  const yearOf = (s: AmountStage): string => resolveTimepoint(h, s.at) ?? "9999-12";
  kept.sort((a, b) => yearOf(a).localeCompare(yearOf(b)));
  if (kept.length > 0) r.propertyTax.stages = kept;
  else delete r.propertyTax.stages;
  return JSON.stringify(r) !== before;
}

/** 世帯の購入の予定の持ち家の推定を入れ直す（refreshEstimates から） */
export function refreshPropertyTax(h: Household, endYear: number, landShareSetting?: string): void {
  for (const r of h.residences ?? []) applyPropertyTaxEstimate(h, r, endYear, landShareSetting);
}
