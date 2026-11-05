// 収益不動産のタブ（物件ごと・年ごとの分析の数字）の提示用の値を作る（作業の層。0016 の2・0082）。
// - 数字はエンジンの分析の数字（summary.realEstateAnalysis。asset.realEstateAnalysis の出力）を読むだけで、ここでは計算し直さない。
//   率の書き方は提案書と同じ部品（report/src/rentalText.ts の pctText・timesText）。金額は万円（小数1桁）、月の手残りは円
// - 年は他の画面と同じ並び（displayYears。計算基準月が1月でなければ翌年から）。指標を見る年の既定は表の最初の年
// - 月の手残り＝年換算÷12＝その年の手残り÷貸している月数（円未満は0の側へ切り捨て）。全体の月の手残りは物件の月の手残り（切り捨てた後の、
//   行に出す額）の合計。端数を足してから切り捨てると、物件の行の合計と合計の行が1円ずれるため（提案書の全体の1枚も同じ）
// - 売る年を変えた比べ（report/src/rentalSale.ts）: 見ているプランの要求から、見ている物件の売る年だけを変えた写しの要求を作り、画面の側の計算で求める。
//   今の予定の売り方は計算し直さず、そのプランの結果を使う。タブを開いて物件を見ている間だけ求め、計算し直している間は前の結果を見せる
// - 入力項目「収益不動産」の物件の一覧表の利回り・月の手残り（rentalFigures）も、同じ数字の表の最初の年から読む
import { useEffect, useMemo, useState } from "preact/hooks";
import { deadCrossText, depreciationEndText, pctText, saleCompareOf, saleVariantRequest, saleVariants, timesText, type RealEstateAnalysis, type RealEstateAnalysisProperty, type RealEstateAnalysisTotal, type RealEstateAnalysisYear, type SaleCompare, type SaleResult, type SaleVariant } from "../../../report/src/index.ts";
import type { EngineRequest, PreviewResult } from "../engine/types.ts";
import type { RentalMetricModel, RentalPropertyViewModel, RentalSaleModel, RentalTabModel, RentalTableModel, RentalTotalViewModel } from "../presentation/model.ts";
import { group, man } from "../presentation/format.ts";
import { BUILDING_STRUCTURES } from "./input/labels.ts";
import { isLandOnlyKind, RENTAL_KINDS, rentalName, rentalProperties } from "./input/stages/rental.ts";
import { displayYears } from "./present.ts";
import { roles } from "./roles.ts";

type ReportRequest = Parameters<typeof saleVariants>[0];
const asReport = (req: EngineRequest): ReportRequest => req as unknown as ReportRequest;
const asApp = (req: ReportRequest): EngineRequest => req as unknown as EngineRequest;

/** 収益不動産のある世帯か（中身 property を持つ不動産の器がある。0079） */
export const hasRentalProperty = (req: EngineRequest): boolean => rentalProperties(req.input.household).length > 0;

/** 計算の結果の分析の数字（物件が無い・前の版のエンジンの結果なら null） */
export function analysisOf(r: PreviewResult | null | undefined): RealEstateAnalysis | null {
  const a = (r?.summary as { realEstateAnalysis?: RealEstateAnalysis } | null | undefined)?.realEstateAnalysis;
  return a === undefined || a.properties.length === 0 ? null : a;
}

// ---- 書き方 ----

/** 万円（小数1桁。四捨五入・符号は対称。マイナスは「▲」） */
export function man1(yen: number): string {
  const tenths = Math.round(Math.abs(yen) / 1000);
  return (yen < 0 && tenths !== 0 ? "▲" : "") + `${group(Math.floor(tenths / 10))}.${tenths % 10}`;
}
const manYen = (yen: number) => `${man1(yen)}万円`;
/** 見出しの1行の金額（ほかの画面の見出しと同じく、万円の整数） */
const manWhole = (yen: number) => `${man(yen)}万円`;
const yenText = (n: number) => `${n < 0 ? "▲" : ""}${group(n)}円`;
const ymText = (ym: string) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;
const dash = "—";

/** 月の手残り（その年の手残り÷貸している月数。貸していない年は null） */
export function monthlyOf(cash: number, months: number): number | null {
  return months > 0 ? Math.trunc(cash / months) : null;
}

/** 表に出す年（displayYears）のうち、その物件の数字のある年 */
function shownYears<T extends { year: number }>(req: EngineRequest, rows: readonly T[]): T[] {
  const years = new Set(displayYears(req));
  return rows.filter((r) => years.has(r.year));
}

/** 物件の見出しの名前（物件名、無ければ「物件1」…）と種類 */
function nameOf(req: EngineRequest, object: string): { name: string; kind: string | null } {
  const h = req.input.household;
  const a = (h.accounts ?? []).find((x) => x.id === object);
  if (a === undefined) return { name: "物件", kind: null };
  return { name: rentalName(h, a), kind: RENTAL_KINDS.find((o) => o.value === a.property?.kind)?.label ?? null };
}
const titleOf = (n: { name: string; kind: string | null }) => (n.kind === null ? n.name : `${n.name}（${n.kind}）`);

// ---- 見るもの ----

/** 見るものの鍵を解く: "total"・物件の ID・物件の番号（"1" から。画面の確かめ用の #rental=2）。合わなければ既定（2件以上は全体、1件はその物件） */
export function resolveRentalView(a: RealEstateAnalysis, view: string | null): string {
  const ids = a.properties.map((p) => p.object);
  if (view !== null) {
    if (view === "total" && ids.length >= 2) return "total";
    if (ids.includes(view)) return view;
    if (/^\d+$/.test(view)) {
      const id = ids[Number(view) - 1];
      if (id !== undefined) return id;
    }
  }
  return ids.length >= 2 ? "total" : (ids[0] as string);
}

// ---- 指標 ----

const HELP = {
  grossYield: "満室のときの収入（家賃と共益費・駐車場などの月の収入。礼金・更新料は入れない）の年額÷取得価額です。",
  lodgingSales: "その年の宿泊の売上の年額です（表に載る月の分を年に直した額）。",
  occupancy: "入れた稼働率です（1泊の単価×稼働率×営業日数で売上を出しています）。",
  nightly: "入れた1泊の単価です。",
  days: "入れた営業日数です（住宅宿泊事業は年180日まで）。",
  netYield: "（実際に入る収入−経費）の年額÷（取得価額＋取得時の諸費用）です（NOI 利回り）。経費に大きな修繕は入れていません。",
  breakEven: "（経費＋約定の返済）÷満室のときの収入です。入居率がこれを下回ると、税引前の手残りが赤字になる目安です。",
  breakEvenLodging: "（経費＋約定の返済）÷稼働率100%のときの売上です。稼働率がこれを下回ると、税引前の手残りが赤字になる目安です。",
  repaymentRatio: "約定の返済（毎月とボーナスの返済。繰上返済は入れない）÷実際に入る収入です。ローンの無い物件は出しません。",
  dscr: "（実際に入る収入−経費）÷約定の返済です。1倍を下回ると、家賃から経費を引いた額で返済をまかなえません。ローンの無い物件は出しません。",
  ltv: "年末のローン残高÷年末の評価額です。ローンの無い物件は出しません。",
  ccr: "税引前の手残りの年額÷自己資金です。自己資金（収益不動産の取得の欄）を入れたときだけ出します。",
  monthlyBefore: "その年の税引前の手残り（実際に入る収入−経費−大きな修繕−年の返済）を、貸している月数で割った額です。",
  monthlyAfter: "税引前の手残りから、その物件で増える税と社会保険料（所得税・住民税・国民健康保険などの近似。その物件の所得の分）を引いた額を、貸している月数で割った額です。",
  equity: "年末の評価額−年末のローン残高です。売ったときにローンを返した後に残る額の目安で、売却の費用（仲介手数料など）と譲渡所得の税は引いていません（実際の手取りはこれより少なくなります）。",
  unrealizedGain: "年末の評価額−年末の帳簿価額です。帳簿価額は、取得価額＋取得時の諸費用−その年の年末までの減価償却費の累計です。売ったときの譲渡所得の目安で、売却の費用と税は引いていません。取得価額を入れていなければ出しません。",
  age: "築年数はその年−建った年、残りの耐用年数は建物の構造の法定耐用年数−築年数です（0より下げません）。",
  depreciationEnd: "建物（と建物附属設備）の減価償却が終わる年です。終わった後は不動産所得が増え、税が増えます。売る・貸し終わるまでに終わらないときは「売るまでには終わりません」と出し、そのまま貸し続けたら終わる年を括弧に書きます。取得価額を入れていないとき、建物の無い物件（貸している土地・駐車場で設備を入れていない）は、減価償却をしないので出しません。",
  deadCross: "元金の返済が減価償却費（建物と建物附属設備）を上回る最初の年です。この年から、帳簿の上の所得より手元に残るお金が少なくなり、税の分だけ手残りが苦しくなりやすくなります。計算の最初の年から上回っていれば「もう上回っています」と出します。ローンの無い物件・上回る年が表の期間に無い物件は出しません。",
} as const;

const yearsText = (n: number | null) => (n === null ? dash : `${n}年`);

/** 減価償却が終わる年が無いときの、理由の分かる文 */
function noDepreciationText(p: RealEstateAnalysisProperty, landOnly: boolean): string {
  if (p.acquisition === null) return "—（取得価額が未入力）";
  if (landOnly && p.builtYear === null) return "—（減価償却する建物がありません）";
  return dash;
}

/** 物件のその年の指標。baseYear は計算基準年（計算の最初の年）、landOnly は種類が貸している土地・駐車場 */
export function propertyMetrics(p: RealEstateAnalysisProperty, y: RealEstateAnalysisYear | undefined, o: { baseYear: number; landOnly?: boolean } = { baseYear: 0 }): RentalMetricModel[] {
  const out: RentalMetricModel[] = [];
  const m = (key: string, label: string, value: string, help: string) => out.push({ key, label, value, help });
  if (p.lodging) {
    const l = y?.lodging;
    const sales = l?.sales ?? (y !== undefined && y.months > 0 ? Math.floor((y.rent * 12) / y.months) : null);
    m("occupancy", "稼働率", pctText(l?.occupancy), HELP.occupancy);
    m("nightly", "1泊の単価", l === undefined ? dash : yenText(l.nightly), HELP.nightly);
    m("days", "営業日数", l === undefined ? dash : `${l.days}日`, HELP.days);
    m("sales", "年の売上", sales === null ? dash : manYen(sales), HELP.lodgingSales);
  } else m("grossYield", "表面利回り", pctText(y?.grossYield), HELP.grossYield);
  m("netYield", "実質利回り", pctText(y?.netYield), HELP.netYield);
  m("breakEven", p.lodging ? "損益分岐の稼働率" : "損益分岐の入居率", pctText(y?.breakEven), p.lodging ? HELP.breakEvenLodging : HELP.breakEven);
  m("repaymentRatio", "返済比率", pctText(y?.repaymentRatio), HELP.repaymentRatio);
  m("dscr", "返済余裕率（DSCR）", timesText(y?.dscr), HELP.dscr);
  m("ltv", "借入の割合（LTV）", pctText(y?.ltv), HELP.ltv);
  m("ccr", "自己資金に対する手残りの割合（CCR）", pctText(y?.ccr), HELP.ccr);
  const before = y === undefined ? null : monthlyOf(y.cashBeforeTax, y.months);
  const after = y === undefined ? null : monthlyOf(y.cashAfterTax, y.months);
  m("monthlyBefore", "月の手残り（税引前）", before === null ? dash : yenText(before), HELP.monthlyBefore);
  m("monthlyAfter", "月の手残り（税引後）", after === null ? dash : yenText(after), HELP.monthlyAfter);
  m("unrealizedGain", "含み益", y?.unrealizedGain == null ? (p.acquisition === null ? "—（取得価額が未入力）" : dash) : manYen(y.unrealizedGain), HELP.unrealizedGain);
  m("equity", "売ったときの手残りの目安（ローン返済後）", y?.equity == null ? dash : manYen(y.equity), HELP.equity);
  if (p.builtYear !== null || o.landOnly !== true) m("age", "築年数／残りの耐用年数", y?.age == null ? dash : `${y.age}年／${yearsText(y.remainingLife)}`, HELP.age);
  const endText = depreciationEndText({ ...p, sells: p.exit !== null }) ?? noDepreciationText(p, o.landOnly === true);
  m("depreciationEnd", "減価償却が終わる年", endText, HELP.depreciationEnd);
  m("deadCross", "元金の返済が減価償却費を上回る年", deadCrossText(p.deadCross, o.baseYear) ?? dash, HELP.deadCross);
  return out;
}

// ---- 年ごとの表 ----

type Amounts = RealEstateAnalysisYear | RealEstateAnalysisTotal;

/** 年ごとの表（物件と全体で同じ列。大きな修繕は1年でもあれば列を出す） */
export function yearTable(rows: readonly Amounts[], opt: { lodging: boolean; deadCross: number | null }): RentalTableModel {
  const repairs = rows.some((r) => r.repairs > 0);
  const cols: { key: string; label: string; get: (r: Amounts) => number | null }[] = [
    { key: "rent", label: opt.lodging ? "売上" : "家賃収入", get: (r) => r.rent },
    { key: "expenses", label: "経費", get: (r) => r.expenses },
    ...(repairs ? [{ key: "repairs", label: "大きな修繕", get: (r: Amounts) => r.repairs }] : []),
    { key: "depreciation", label: "減価償却", get: (r) => r.depreciation },
    { key: "interest", label: "利息", get: (r) => r.interest },
    { key: "income", label: opt.lodging ? "所得" : "不動産所得", get: (r) => r.income },
    { key: "repayment", label: "返済", get: (r) => r.repayment },
    { key: "cashBeforeTax", label: "手残り（税引前）", get: (r) => r.cashBeforeTax },
    { key: "cashAfterTax", label: "手残り（税引後）", get: (r) => r.cashAfterTax },
    { key: "loanBalance", label: "ローン残高", get: (r) => r.loanBalance },
    { key: "value", label: "評価額", get: (r) => r.value },
  ];
  return {
    columns: [{ key: "year", label: "年" }, ...cols.map(({ key, label }) => ({ key, label }))],
    rows: rows.map((r) => {
      const v = cols.map((c) => c.get(r));
      return { year: r.year, cells: v.map((x) => (x === null ? dash : man1(x))), negative: v.map((x) => x !== null && x < 0), deadCross: opt.deadCross === r.year };
    }),
  };
}

// ---- 一覧（全体の物件ごとの行・入力項目の一覧表） ----

export interface RentalFigure {
  grossYield: string;
  netYield: string;
  /** 月の手残り（税引前。その年に貸していなければ null） */
  monthly: number | null;
}

/** 物件の一覧表の数字（表の最初の年。物件ごとと合計）。数字が無ければ null */
export function rentalFigures(req: EngineRequest, a: RealEstateAnalysis | null): { year: number; byObject: Map<string, RentalFigure>; total: RentalFigure } | null {
  const year = displayYears(req)[0];
  if (a === null || year === undefined) return null;
  return { year, ...figuresAt(a, year) };
}

function figuresAt(a: RealEstateAnalysis, year: number): { byObject: Map<string, RentalFigure>; total: RentalFigure } {
  const byObject = new Map<string, RentalFigure>();
  let sum: number | null = null;
  for (const p of a.properties) {
    const y = p.years.find((x) => x.year === year);
    const monthly = y === undefined ? null : monthlyOf(y.cashBeforeTax, y.months);
    // 物件の行に出す額（円未満を切り捨てた額）を足す。合計の行が物件の行の足し算と一致するように
    if (monthly !== null) sum = (sum ?? 0) + monthly;
    byObject.set(p.object, { grossYield: p.lodging ? dash : pctText(y?.grossYield), netYield: pctText(y?.netYield), monthly });
  }
  const t = a.total.find((x) => x.year === year);
  return { byObject, total: { grossYield: pctText(t?.grossYield), netYield: pctText(t?.netYield), monthly: sum } };
}

const TOTAL_COLUMNS = [
  { key: "name", label: "物件名" },
  { key: "kind", label: "種類" },
  { key: "grossYield", label: "表面利回り" },
  { key: "netYield", label: "実質利回り" },
  { key: "monthly", label: "月の手残り（税引前）" },
  { key: "repaymentRatio", label: "返済比率" },
  { key: "dscr", label: "DSCR" },
  { key: "ltv", label: "LTV" },
  { key: "loanBalance", label: "ローン残高" },
  { key: "value", label: "評価額" },
];

function totalView(req: EngineRequest, a: RealEstateAnalysis, year: number): RentalTotalViewModel {
  const f = figuresAt(a, year);
  const rows = a.properties.map((p) => {
    const y = p.years.find((x) => x.year === year);
    const fig = f.byObject.get(p.object) as RentalFigure;
    const n = nameOf(req, p.object);
    return {
      key: p.object,
      cells: [n.name, n.kind ?? dash, fig.grossYield, fig.netYield, fig.monthly === null ? dash : yenText(fig.monthly), pctText(y?.repaymentRatio), timesText(y?.dscr), pctText(y?.ltv), y === undefined || y.loanBalance === 0 ? dash : manYen(y.loanBalance), y?.value == null ? dash : manYen(y.value)],
    };
  });
  const t = a.total.find((x) => x.year === year);
  const totalRow = [`合計（${a.properties.length}件）`, "", f.total.grossYield, f.total.netYield, f.total.monthly === null ? dash : yenText(f.total.monthly), pctText(t?.repaymentRatio), timesText(t?.dscr), pctText(t?.ltv), t === undefined ? dash : manYen(t.loanBalance), t === undefined ? dash : manYen(t.value)];
  return { kind: "total", key: "total", year, columns: TOTAL_COLUMNS, rows, totalRow, table: yearTable(shownYears(req, a.total), { lodging: false, deadCross: null }) };
}

// ---- 物件 ----

function factsOf(req: EngineRequest, p: RealEstateAnalysisProperty): string[] {
  const h = req.input.household;
  const a = (h.accounts ?? []).find((x) => x.id === p.object);
  const prop = a?.property;
  const out: string[] = [];
  const owner = roles(req).find((r) => r.member.id === p.owner)?.label;
  if (owner !== undefined) out.push(`名義 ${owner}`);
  // 建物の無い物件（貸している土地・駐車場）は構造を出さない（前の版で入れた値が残っていても）
  const st = p.builtYear === null ? undefined : BUILDING_STRUCTURES.find((o) => o.value === prop?.structure)?.label;
  if (st !== undefined) out.push(st);
  if (p.builtYear !== null) out.push(`${p.builtYear}年築`);
  const acq = prop?.acquisition;
  if (acq !== undefined && p.acquisition !== null) {
    const extra = [...(p.acquisition.costs > 0 ? [`諸費用 ${manWhole(p.acquisition.costs)}`] : []), ...(p.acquisition.equity !== undefined ? [`自己資金 ${manWhole(p.acquisition.equity)}`] : [])];
    out.push(`${ymText(acq.at)}に取得 ${manWhole(p.acquisition.total)}${extra.length > 0 ? `（${extra.join("・")}）` : ""}`);
  }
  if (p.exit !== null) out.push(`${ymText(p.exit.ym)}に売る予定`);
  return out;
}

const kindOf = (req: EngineRequest, object: string): string | undefined => (req.input.household.accounts ?? []).find((x) => x.id === object)?.property?.kind;

function propertyView(req: EngineRequest, p: RealEstateAnalysisProperty, year: number | null, sale: RentalSaleModel | null): RentalPropertyViewModel {
  const rows = shownYears(req, p.years);
  const baseYear = Number(req.input.baseMonth.slice(0, 4));
  const y = (year === null ? undefined : rows.find((r) => r.year === year)) ?? rows.find((r) => r.months > 0) ?? rows[0];
  return {
    kind: "property",
    key: p.object,
    title: titleOf(nameOf(req, p.object)),
    facts: factsOf(req, p),
    year: y?.year ?? displayYears(req)[0] ?? 0,
    metrics: propertyMetrics(p, y, { baseYear, landOnly: isLandOnlyKind(kindOf(req, p.object)) }),
    // 計算の最初の年から上回っている（「もう上回っています」）ときは、表の行に印を付けない
    table: yearTable(rows, { lodging: p.lodging, deadCross: p.deadCross !== null && p.deadCross > baseYear ? p.deadCross : null }),
    deadCross: p.deadCross,
    sale,
  };
}

/** 選んでいる見るもの・指標の年（画面の側の状態。null は既定） */
export interface RentalUi {
  view: string | null;
  year: number | null;
}

/** 売る年を変えた比べの今の状態（useRentalSale） */
export type RentalSaleState = { object: string; status: "loading" } | { object: string; status: "ready"; compare: SaleCompare | null };

const saleModelOf = (s: RentalSaleState | null, object: string): RentalSaleModel | null => {
  if (s === null || s.object !== object) return null;
  if (s.status === "loading") return { status: "loading" };
  if (s.compare === null) return { status: "error" };
  return {
    status: "ready",
    endYear: s.compare.endYear,
    rows: s.compare.rows.map((r) => ({
      label: r.label,
      current: r.current,
      net: r.net === null ? dash : manYen(r.net),
      financialEnd: manYen(r.financialEnd),
      diff: r.current ? dash : `${r.diff > 0 ? "+" : r.diff < 0 ? "▲" : "±"}${man1(Math.abs(r.diff))}万円`,
      equityEnd: r.equityEnd === null ? dash : manYen(r.equityEnd),
    })),
  };
};

/** 収益不動産のタブの提示用の値（収益不動産の無い世帯は null） */
export function rentalTabModel(p: { req: EngineRequest; result: PreviewResult; ui: RentalUi; sale: RentalSaleState | null; provisional: boolean }): RentalTabModel | null {
  if (!hasRentalProperty(p.req)) return null;
  const a = analysisOf(p.result);
  if (a === null) return { views: [], selected: "", view: null, provisional: p.provisional };
  const selected = resolveRentalView(a, p.ui.view);
  const views = [...(a.properties.length >= 2 ? [{ key: "total", label: "全体" }] : []), ...a.properties.map((x) => ({ key: x.object, label: titleOf(nameOf(p.req, x.object)) }))];
  const firstYear = displayYears(p.req)[0] ?? 0;
  let view: RentalTabModel["view"];
  if (selected === "total") {
    const years = shownYears(p.req, a.total).map((t) => t.year);
    view = totalView(p.req, a, p.ui.year !== null && years.includes(p.ui.year) ? p.ui.year : (years[0] ?? firstYear));
  } else {
    const prop = a.properties.find((x) => x.object === selected) as RealEstateAnalysisProperty;
    view = propertyView(p.req, prop, p.ui.year, saleModelOf(p.sale, prop.object));
  }
  return { views, selected, view, provisional: p.provisional };
}

// ---- 写しの要求の計算（画面の側。0075 の「写しの要求」） ----

type ComputeOne = (req: EngineRequest) => Promise<PreviewResult | null>;

/** 物件の売る年の比べに要る写しの要求（今の予定は null＝プランの結果を使う）。比べる売り方が1つ以下なら null */
export function saleJobs(req: EngineRequest, object: string): { variants: SaleVariant[]; requests: (EngineRequest | null)[] } | null {
  const variants = saleVariants(asReport(req), object);
  if (variants.length < 2) return null;
  return { variants, requests: variants.map((v) => (v.current ? null : asApp(saleVariantRequest(asReport(req), object, v)))) };
}

/** 写しの結果から比べの行を作る（current はプランの結果） */
export function saleCompareFrom(req: EngineRequest, object: string, variants: readonly SaleVariant[], results: readonly (PreviewResult | null)[], current: PreviewResult): SaleCompare | null {
  const rs = variants.map((v, i) => (v.current ? current : (results[i] ?? null))) as unknown as (SaleResult | null)[];
  return saleCompareOf(object, req.input.endYear, variants, rs);
}

/**
 * 売る年を変えた比べ（見ている物件の分だけ）。active の間だけ求め、計算し直している間は前の結果（同じ物件のもの）を見せる。
 * 初めて求める物件は loading。計算の道が無ければ null
 */
export function useRentalSale(req: EngineRequest | null, result: PreviewResult | null, object: string | null, active: boolean, computeOne: ComputeOne | undefined): RentalSaleState | null {
  const jobs = useMemo(() => (active && req !== null && object !== null && computeOne !== undefined ? { object, req, jobs: saleJobs(req, object) } : null), [active, req, object, computeOne]);
  const key = useMemo(() => (jobs === null ? null : JSON.stringify([jobs.object, jobs.jobs?.requests ?? null])), [jobs]);
  const [got, setGot] = useState<{ key: string; object: string; req: EngineRequest; variants: SaleVariant[]; results: (PreviewResult | null)[] } | null>(null);
  useEffect(() => {
    if (jobs === null || key === null || jobs.jobs === null || computeOne === undefined) return;
    let alive = true;
    const { variants, requests } = jobs.jobs;
    void Promise.all(requests.map((q) => (q === null ? Promise.resolve(null) : computeOne(q).catch(() => null)))).then((results) => {
      if (alive) setGot({ key, object: jobs.object, req: jobs.req, variants, results });
    });
    return () => {
      alive = false;
    };
  }, [key, computeOne]);
  if (jobs === null || result === null) return null;
  if (jobs.jobs === null) return { object: jobs.object, status: "ready", compare: null };
  if (got === null || got.object !== jobs.object) return { object: jobs.object, status: "loading" };
  return { object: jobs.object, status: "ready", compare: saleCompareFrom(got.req, got.object, got.variants, got.results, result) };
}

/** 入力項目の物件の一覧表の数字（世帯の今の要求を1回求める）。計算の道が無ければ null、求めている間（初め）は "loading" */
export function useRentalFigures(req: EngineRequest, active: boolean, computeOne: ComputeOne | undefined): ReturnType<typeof rentalFigures> | "loading" | null {
  const on = active && computeOne !== undefined && hasRentalProperty(req);
  const key = useMemo(() => (on ? JSON.stringify(req) : null), [on, req]);
  const [res, setRes] = useState<{ req: EngineRequest; r: PreviewResult | null } | null>(null);
  useEffect(() => {
    if (key === null || computeOne === undefined) return;
    let alive = true;
    void computeOne(req).then(
      (r) => alive && setRes({ req, r }),
      () => alive && setRes({ req, r: null }),
    );
    return () => {
      alive = false;
    };
  }, [key, computeOne]);
  if (!on) return null;
  // 計算し直している間は、前の結果を見せておく（数字が消えてちらつかないように）
  if (res === null) return "loading";
  return rentalFigures(res.req, analysisOf(res.r));
}
