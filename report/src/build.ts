// 計算の要求と正の計算の結果（ProposalBundle）から、帳票の入力（ProposalInput。0009 の9）を組み立てる。
// - 金額は計算エンジンの出力（表のマス・要約・必要保障額）をそのまま写すか、年ごと・行ごとに足したもの（円の整数のまま）。
//   2つの計算の差（提案−現状など）もここで取る。帳票（Typst）の側では計算しない。
// - 世帯の内部 ID（構成員・物の ID）、氏名・宛名、FP のメモ、カスタム計算の印は写さない（0009 の9・0016 の2）。
// - 構成員の呼び方と表の行の決め方は、アプリの提示の値（app/src/workspace/roles.ts・present.ts）と同じにしている。
import type { EngineOutput, EngineRequest, ProposalBundle, Run, TableCell } from "./bundle.ts";
import { selectChapters } from "./chapters.ts";
import { bsSeries, BS_GROUP_LABEL, groupTotal, type BsGroup } from "./bsGroups.ts";
import { DEFAULT_MONEY_THREE, moneyThreeModel, type MoneyThreeModel } from "./moneyThree.ts";
import {
  type Comparison,
  DEFAULT_LAYOUT,
  PROPOSAL_INPUT_FORMAT,
  PROPOSAL_INPUT_VERSION,
  type CfRow,
  type BalanceFigure,
  type BalanceSheetView,
  type ColoredAmount,
  type InvestmentView,
  type MarketDropView,
  type CfTable,
  type NamedAmount,
  type Outcome,
  type ProposalInput,
  type ProtectionView,
  type ScenarioView,
  type YearPoint,
  type YearTable,
  type Yen,
} from "./input.ts";

type Household = EngineRequest["input"]["household"];
type Member = Household["members"][number];
type Timepoint = NonNullable<Member["joins"]>;

const under = (row: string, prefix: string): boolean => row === prefix || row.startsWith(prefix + ".");

// ---- 時点と年齢 ----

export function parseYm(s: string): { y: number; m: number } {
  const [y, m] = s.split("-").map(Number) as [number, number];
  return { y, m };
}

const ym = (y: number, m: number): string => `${y}-${String(m).padStart(2, "0")}`;

function addMonths(s: string, n: number): string {
  const { y, m } = parseYm(s);
  const i = y * 12 + (m - 1) + n;
  return ym(Math.floor(i / 12), (i % 12) + 1);
}

/** その年齢に達する月（1日生まれは前の月） */
function ageReachedMonth(member: Member, age: number): string {
  const { y, m } = parseYm(member.birth.birthYearMonth);
  return addMonths(ym(y + age, m), member.birth.bornOnFirst ? -1 : 0);
}

/** その月の時点の満年齢 */
function ageAt(member: Member, month: string): number {
  let age = parseYm(month).y - parseYm(member.birth.birthYearMonth).y;
  if (ageReachedMonth(member, age) > month) age--;
  else if (ageReachedMonth(member, age + 1) <= month) age++;
  return age;
}

/** 各年12月末時点の年齢 */
const ageInYear = (m: Member, year: number): number => year - parseYm(m.birth.birthYearMonth).y;

const leaveYear = (m: Member): number | null => (m.leaves !== null && "at" in m.leaves ? parseYm(m.leaves.at).y : null);

const atOf = (t: Timepoint | null | undefined): string | null => (t !== null && t !== undefined && "at" in t ? t.at : null);

const monthLabel = (s: string): string => {
  const { y, m } = parseYm(s);
  return `${y}年${m}月`;
};

/** 表に出す年: 計算基準月が年の途中なら翌年から、表の最後の年まで */
export function displayYears(req: EngineRequest): number[] {
  const { y, m } = parseYm(req.input.baseMonth);
  const out: number[] = [];
  for (let year = m > 1 ? y + 1 : y; year <= req.input.endYear; year++) out.push(year);
  return out;
}

// ---- 構成員の呼び方（顧客の名前は持たない・出さない。0012）----

export interface Role<M = Member> {
  key: string;
  label: string;
  member: M;
}

/** 呼び方を決めるのに使う構成員の欄（アプリの画面の型でも渡せるように、要るところだけ） */
export interface RoleMember {
  kind: string;
  sex: string;
  birth: { birthYearMonth: string };
}

const ORDINAL_SON = ["長男", "次男", "三男", "四男", "五男"];
const ORDINAL_DAUGHTER = ["長女", "次女", "三女", "四女", "五女"];

export function roles<M extends RoleMember = Member>(req: { input: { household: { members: readonly M[] } } }): Role<M>[] {
  const ms = req.input.household.members;
  const self = ms.find((m) => m.kind === "self");
  const spouse = ms.find((m) => m.kind === "spouse");
  const out: Role<M>[] = [];
  const coupleLabel = (m: M) => (m.sex === "female" ? "奥様" : "ご主人");
  if (self !== undefined) out.push({ key: "self", label: spouse !== undefined ? coupleLabel(self) : "ご本人", member: self });
  if (spouse !== undefined) out.push({ key: "spouse", label: coupleLabel(spouse), member: spouse });
  const children = ms.filter((m) => m.kind === "child").sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? -1 : 1));
  let sons = 0;
  let daughters = 0;
  children.forEach((m, i) => {
    const label = m.sex === "female" ? (ORDINAL_DAUGHTER[daughters++] ?? "お子さま") : (ORDINAL_SON[sons++] ?? "お子さま");
    out.push({ key: `child${i + 1}`, label, member: m });
  });
  ms.filter((m) => m.kind !== "self" && m.kind !== "spouse" && m.kind !== "child").forEach((m, i) => out.push({ key: `other${i + 1}`, label: "ご家族", member: m }));
  return out;
}

const presentIn = (r: Role, y: number): boolean => ageInYear(r.member, y) >= 0 && (leaveYear(r.member) === null || y <= (leaveYear(r.member) as number));

// ---- 表のマスの集計 ----

export function sumByYear(table: readonly TableCell[], pred: (c: TableCell) => boolean): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of table) if (pred(c)) out.set(c.year, (out.get(c.year) ?? 0) + c.amount);
  return out;
}

const financialOf = (r: EngineOutput) => sumByYear(r.table, (c) => c.row === "cf.balance.financial");

const seriesOf = (m: Map<number, number>, years: readonly number[]): Yen[] => years.map((y) => m.get(y) ?? 0);

const total = (m: Map<number, number>, years: readonly number[]): Yen => years.reduce((s, y) => s + (m.get(y) ?? 0), 0);

function depletionYear(r: EngineOutput, years: readonly number[]): number | null {
  const fin = financialOf(r);
  for (const y of years) if ((fin.get(y) ?? 0) < 0) return y;
  return null;
}

// ---- 書式（計算ではない）----

function group(n: number): string {
  return String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const yenText = (n: number): string => `${n < 0 ? "▲" : ""}${group(n)}円`;

/** 小数の文字列の率を百分率の文字列にする（"0.0065" → "0.65%"）。数としては計算しない */
export function percent(rate: string): string {
  const neg = rate.startsWith("-");
  const body = neg ? rate.slice(1) : rate;
  const [i = "0", f = ""] = body.split(".");
  const frac = f.padEnd(2, "0");
  const intPart = String(Number(i + frac.slice(0, 2)));
  const rest = frac.slice(2).replace(/0+$/, "");
  return `${neg ? "−" : ""}${intPart}${rest !== "" ? "." + rest : ""}%`;
}

// ---- 表の行の決め方（アプリの rowDefs と同じ）----

interface RowDef {
  key: string;
  label: string;
  group: "income" | "expense" | "net" | "assets";
  kind: "value" | "total";
  match: (c: TableCell) => boolean;
}

/** 車（何台でも）の支出のマス: 買い替え・維持費（車検・税・保険・駐車場・燃料）・ローンの返済。車の物の ID で見分ける */
export function carExpense(req: EngineRequest): (c: TableCell) => boolean {
  const ids = new Set((req.input.household.cars ?? []).map((c) => c.id));
  return (c) => ids.size > 0 && c.object !== undefined && ids.has(c.object) && under(c.row, "cf.expense");
}

function rowDefs(req: EngineRequest): RowDef[] {
  const rs = roles(req).filter((r) => r.key === "self" || r.key === "spouse");
  const defs: RowDef[] = [];
  const byMember = (prefix: string, role: Role) => (c: TableCell) => under(c.row, prefix) && c.member === role.member.id;
  // 車があるときだけ「車」の行を出し、車の支出はほかの行（基本生活費・保険料・一時的な支出・その他）から外す（台数が増えても1行）
  const hasCar = (req.input.household.cars ?? []).length > 0;
  const car = carExpense(req);
  const notCar = (p: (c: TableCell) => boolean) => (c: TableCell) => p(c) && !car(c);
  // 住まい以外の不動産の家賃収入・経費があるときだけ、その行を出す（ほかの行から外す。アプリと同じ）
  const props = (req.input.household.accounts ?? []).filter((a) => a.kind === "realEstate" && a.property !== undefined);
  const hasRent = props.some((a) => a.property?.rental !== undefined);
  const hasReExp = props.some((a) => a.property?.rental !== undefined || a.property?.expenses !== undefined);
  const isRent = (c: TableCell) => hasRent && c.row === "cf.income.other.rental";
  const isReExp = (c: TableCell) => hasReExp && c.row === "cf.expense.other.realEstate";
  for (const r of rs) defs.push({ key: `salary:${r.key}`, label: `${r.label}の給与`, group: "income", kind: "value", match: byMember("cf.income.salary", r) });
  for (const r of rs) defs.push({ key: `pension:${r.key}`, label: `${r.label}の年金`, group: "income", kind: "value", match: byMember("cf.income.pension", r) });
  const ids = new Set(rs.map((r) => r.member.id));
  const known = (c: TableCell, p: string) => under(c.row, p) && c.member !== undefined && ids.has(c.member);
  const known5 = ["cf.expense.living", "cf.expense.housing", "cf.expense.education", "cf.expense.insurance", "cf.expense.lumpSum", "cf.expense.advisoryFee"];
  defs.push(
    { key: "retirement", label: "退職金", group: "income", kind: "value", match: (c) => under(c.row, "cf.income.lumpSum.retirement") },
    { key: "benefit", label: "給付・手当", group: "income", kind: "value", match: (c) => under(c.row, "cf.income.benefit") },
    ...(hasRent ? [{ key: "rent", label: "家賃収入", group: "income" as const, kind: "value" as const, match: isRent }] : []),
    {
      key: "incomeOther",
      label: "その他の収入",
      group: "income",
      kind: "value",
      match: (c) => under(c.row, "cf.income") && !known(c, "cf.income.salary") && !known(c, "cf.income.pension") && !under(c.row, "cf.income.lumpSum.retirement") && !under(c.row, "cf.income.benefit") && !isRent(c),
    },
    { key: "incomeTotal", label: "収入合計", group: "income", kind: "total", match: (c) => under(c.row, "cf.income") },
    { key: "living", label: "基本生活費", group: "expense", kind: "value", match: notCar((c) => under(c.row, "cf.expense.living") && c.row !== "cf.expense.living.surplus") },
    // 黒字のうち貯まらない分（0031。値のある年だけ）
    { key: "surplusSpend", label: "ゆとりの支出", group: "expense", kind: "value", match: (c) => c.row === "cf.expense.living.surplus" },
    { key: "housing", label: "住居費（ローン・税・修繕）", group: "expense", kind: "value", match: (c) => under(c.row, "cf.expense.housing") },
    { key: "education", label: "教育費", group: "expense", kind: "value", match: (c) => under(c.row, "cf.expense.education") },
    { key: "insurance", label: "保険料", group: "expense", kind: "value", match: notCar((c) => under(c.row, "cf.expense.insurance")) },
    { key: "lumpSum", label: "一時的な支出（旅行など）", group: "expense", kind: "value", match: notCar((c) => under(c.row, "cf.expense.lumpSum")) },
    ...(hasCar ? [{ key: "car", label: "車の費用", group: "expense" as const, kind: "value" as const, match: car }] : []),
    ...(hasReExp ? [{ key: "realEstateExpense", label: "不動産の経費", group: "expense" as const, kind: "value" as const, match: isReExp }] : []),
    { key: "advisoryFee", label: "FP顧問料", group: "expense", kind: "value", match: (c) => under(c.row, "cf.expense.advisoryFee") },
    { key: "expenseOther", label: "その他の支出", group: "expense", kind: "value", match: notCar((c) => under(c.row, "cf.expense") && !known5.some((p) => under(c.row, p)) && !isReExp(c)) },
    { key: "taxSi", label: "税・社会保険料", group: "expense", kind: "value", match: (c) => under(c.row, "cf.taxSi") },
    { key: "expenseTotal", label: "支出合計", group: "expense", kind: "total", match: (c) => under(c.row, "cf.expense") || under(c.row, "cf.taxSi") },
    { key: "net", label: "年間収支", group: "net", kind: "total", match: (c) => c.row === "cf.net" },
    { key: "nisaIn", label: "NISAへの積立", group: "assets", kind: "value", match: (c) => under(c.row, "cf.transfer.nisa") },
    { key: "financial", label: "金融資産残高", group: "assets", kind: "total", match: (c) => c.row === "cf.balance.financial" },
    { key: "debt", label: "住宅ローン残高", group: "assets", kind: "value", match: (c) => under(c.row, "cf.balance.debt") },
  );
  return defs;
}

const GROUP_LABEL: Record<RowDef["group"], string> = { income: "収入", expense: "支出", net: "", assets: "貯蓄・資産" };

function cashflowTable(run: Run, years: readonly number[], title: string): CfTable {
  const rows: CfRow[] = [];
  let lastGroup: RowDef["group"] | null = null;
  for (const d of rowDefs(run.request)) {
    const sums = sumByYear(run.result.table, d.match);
    const cells = years.map((y) => sums.get(y) ?? null);
    if (d.kind === "value" && cells.every((c) => (c ?? 0) === 0)) continue;
    if (d.group !== lastGroup && GROUP_LABEL[d.group] !== "") rows.push({ kind: "group", key: `group:${d.group}`, label: GROUP_LABEL[d.group], cells: [] });
    lastGroup = d.group;
    rows.push({ kind: d.kind, key: d.key, label: d.label, cells });
  }
  return { title, rows };
}

// ---- ラベルの表 ----

const ACCOUNT_LABEL: Record<string, string> = {
  deposit: "預金",
  taxable: "課税口座（株式・投資信託）",
  nisa: "NISA",
  juniorNisa: "ジュニアNISA",
  childNisa: "こどもNISA",
  legacyNisa: "旧NISA",
  ideco: "iDeCo",
  corporateDc: "企業型DC",
  zaikei: "財形貯蓄",
  esop: "持株会",
  fxDeposit: "外貨預金",
  insurance: "保険（積立部分）",
  realEstate: "不動産",
  smallBusinessMutualAid: "小規模企業共済",
  otherAsset: "その他の資産",
  car: "車",
};

const PACK_LABEL: Record<string, string> = {
  "regulation.tax": "所得税・住民税",
  "regulation.socialInsurance": "社会保険",
  "regulation.pension": "公的年金",
  "regulation.nisaIdeco": "NISA・iDeCo",
  "regulation.housing": "住宅",
  "regulation.educationSupport": "教育の支援制度",
  "regulation.retirement": "退職給付",
  "master.lifeTable": "生命表（平均余命）",
  "master.education.statistics": "教育費の統計",
  "master.education.tuition": "学校別の学費",
  "master.care.statistics": "介護の統計",
  "master.wageStats": "賃金・事業所得の統計",
  "master.retirementBenefit": "退職給付の統計",
  "master.living.statistics": "生活費の統計",
};

const INSURANCE_LABEL: Record<string, string> = {
  "insurance.wholeLife": "終身保険",
  "insurance.term": "定期保険",
  "insurance.incomeProtection": "収入保障保険",
  "insurance.incapacity": "就業不能保険",
  "insurance.medical": "医療保険",
  "insurance.cancer": "がん保険",
  "insurance.endowment": "養老保険",
  "insurance.education": "学資保険",
  "insurance.privateAnnuity": "個人年金保険",
  "insurance.nonLife": "損害保険（火災・地震など）",
};

const BENEFIT_LABEL: Record<string, string> = {
  death: "死亡保険金",
  incomeProtection: "収入保障（月額）",
  incapacity: "就業不能給付（月額）",
  highDisability: "高度障害保険金",
  maturity: "満期保険金",
  annuity: "年金",
  survival: "生存給付金",
  hospitalDaily: "入院給付（日額）",
  surgery: "手術給付",
  cancerLump: "がん診断一時金",
  threeMajorLump: "三大疾病一時金",
  other: "その他の給付",
};

const STAGE_AGE: Record<string, number> = { elementary: 6, juniorHigh: 12, highSchool: 15, university: 18 };
const STAGE_NAME: Record<string, string> = { elementary: "小学校", juniorHigh: "中学校", highSchool: "高校", university: "大学" };
const SECTOR: Record<string, string> = { public: "公立", private: "私立", national: "国立" };
const FIELD: Record<string, string> = { humanities: "文系", science: "理系", medical: "医歯系" };
const LIVING: Record<string, string> = { away: "自宅外", home: "自宅" };

/** 遺族の生活費の割合の既定（エンジンの expense.living・protection.need の既定と同じ。省略したときの値） */
const SURVIVOR_DEFAULT = { beforeIndependence: "0.7", afterIndependence: "0.5", noChildren: "0.7" };

function schoolEntryYear(m: Member, stage: string): number | null {
  const age = STAGE_AGE[stage];
  if (age === undefined) return null;
  const { y, m: mo } = parseYm(m.birth.birthYearMonth);
  const early = mo < 4 || (mo === 4 && m.birth.bornOnFirst);
  return y + age + (early ? 0 : 1);
}

// ---- 部分ごとの組み立て ----

interface Ctx {
  bundle: ProposalBundle;
  years: number[];
  rs: Role[];
  self: Role | undefined;
  target: YearPoint;
  baseYear: number;
}

function pointLabel(ctx: Ctx, year: number): string {
  return ctx.self !== undefined ? `${ctx.self.label}${ageInYear(ctx.self.member, year)}歳（${year}年）` : `${year}年`;
}

function outcome(ctx: Ctx, run: Run): Outcome {
  const dep = depletionYear(run.result, ctx.years);
  const t = run.result.summary.totals;
  return {
    financialAtTarget: financialOf(run.result).get(ctx.target.year) ?? 0,
    depletion: dep === null ? null : { year: dep, label: pointLabel(ctx, dep) },
    totals: { income: t.income, taxSi: t.taxSi, expense: t.expense, net: t.net },
  };
}

function retirementMonth(req: EngineRequest, member: Member): string | null {
  const ends = req.input.household.employmentPeriods
    .filter((e) => e.member === member.id)
    .map((e) => atOf(e.to))
    .filter((x): x is string => x !== null)
    .sort();
  const open = req.input.household.employmentPeriods.some((e) => e.member === member.id && e.to === null);
  const last = ends.at(-1);
  return open || last === undefined ? null : addMonths(last, 1);
}

/** 公的年金の受け取りを始める月（基礎年金。指定が無ければ65歳に達した月の翌月） */
function pensionStartMonth(req: EngineRequest, member: Member): string {
  const rec = (req.input.household.pensionRecords ?? []).find((r) => r.member === member.id);
  const claim = atOf(rec?.claim?.basic ?? null);
  return claim ?? addMonths(ageReachedMonth(member, 65), 1);
}

/** 年月か構成員の年齢で決めた時点を年月にする（ほかの形は読めない: null） */
function monthOfTimepoint(h: Household, t: Timepoint | null | undefined): string | null {
  if (t === null || t === undefined) return null;
  if ("at" in t && typeof t.at === "string") return t.at;
  const ma = (t as { memberAge?: { member: string; years: number; months?: number } }).memberAge;
  if (ma === undefined) return null;
  const m = h.members.find((x) => x.id === ma.member);
  return m === undefined ? null : addMonths(ageReachedMonth(m, ma.years), ma.months ?? 0);
}

/** 車の買い替え（購入）の年: 計算エンジンの車の部品と同じ決め方（最初の年月から周期ごと、手放す時点と表の最後まで）。車が2台以上なら「車1」「車2」と分ける */
function carPurchases(req: EngineRequest): { year: number; text: string }[] {
  const h = req.input.household;
  const cars = h.cars ?? [];
  const base = req.input.baseMonth;
  const end = `${req.input.endYear}-12`;
  const out: { year: number; text: string }[] = [];
  cars.forEach((c, i) => {
    const first = monthOfTimepoint(h, c.purchase.first);
    if (first === null || c.purchase.everyYears < 1) return;
    const until = c.until === undefined || c.until === null ? end : (monthOfTimepoint(h, c.until) ?? end);
    const name = cars.length > 1 ? `車${i + 1}` : "車";
    for (let m = first, k = 0; m <= until && m <= end; m = addMonths(m, 12 * c.purchase.everyYears), k++) {
      if (m < base) continue;
      out.push({ year: parseYm(m).y, text: k === 0 && c.purchase.owned !== true ? `${name}を購入` : `${name}の買い替え` });
    }
  });
  return out;
}

function events(ctx: Ctx): ProposalInput["events"] {
  const req = ctx.bundle.proposal.request;
  const h = req.input.household;
  const first = ctx.years[0] ?? 0;
  const last = ctx.years.at(-1) ?? 0;
  const byYear = new Map<number, string[]>();
  const add = (year: number, text: string) => {
    if (year < first || year > last) return;
    const list = byYear.get(year) ?? [];
    list.push(text);
    byYear.set(year, list);
  };
  for (const g of h.goals ?? []) {
    const role = ctx.rs.find((r) => r.member.id === g.owner);
    if (g.kind !== "education" || role === undefined) continue;
    for (const s of g.education?.stages ?? []) {
      const name = STAGE_NAME[s.stage];
      const y = schoolEntryYear(role.member, s.stage);
      if (name === undefined || y === null || (s.stage !== "highSchool" && s.stage !== "university")) continue;
      const detail = (s.sector !== undefined ? (SECTOR[s.sector] ?? "") : "") + (s.field !== undefined ? (FIELD[s.field] ?? "") : "") + (s.living !== undefined ? `・${LIVING[s.living] ?? ""}` : "");
      add(y, `${role.label}が${name}に入学${detail !== "" ? `（${detail}）` : ""}`);
    }
  }
  for (const r of ctx.rs) {
    const ly = leaveYear(r.member);
    if (ly !== null && r.member.kind === "child") add(ly, `${r.label}が独立`);
  }
  for (const r of ctx.rs.filter((x) => x.key === "self" || x.key === "spouse")) {
    const ret = retirementMonth(req, r.member);
    if (ret !== null) add(parseYm(ret).y, `${r.label}が退職（${ageAt(r.member, ret)}歳）`);
    const ps = pensionStartMonth(req, r.member);
    add(parseYm(ps).y, `${r.label}が年金の受け取りを開始（${ageAt(r.member, addMonths(ps, -1))}歳）`);
  }
  for (const e of carPurchases(req)) add(e.year, e.text);
  const loan = sumByYear(ctx.bundle.proposal.result.table, (c) => under(c.row, "cf.expense.housing.loan"));
  const paid = [...loan.entries()].filter(([, v]) => v > 0).map(([y]) => y).sort((a, b) => a - b).at(-1);
  if (paid !== undefined && paid < req.input.endYear) add(paid, "住宅ローンの返済が終わる");
  const fee = ctx.bundle.proposal.result.summary.advisoryFee;
  const feeFirst = fee?.byYear.find((b) => b.amount > 0)?.year;
  if (feeFirst !== undefined) add(Math.max(feeFirst, first), "FP顧問料の支払いを開始");
  const dep = depletionYear(ctx.bundle.proposal.result, ctx.years);
  if (dep !== null) add(dep, "金融資産が不足する（提案）");
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, items]) => ({
      year,
      ages: ctx.rs.filter((r) => presentIn(r, year) && (r.key === "self" || r.key === "spouse")).map((r) => `${r.label}${ageInYear(r.member, year)}歳`).join("・"),
      items,
    }));
}

function basics(ctx: Ctx): ProposalInput["basics"] {
  const run = ctx.bundle.current;
  const year = ctx.years[0] ?? ctx.baseYear;
  const t = run.result.table;
  const sum = (pred: (c: TableCell) => boolean, y = year) => t.reduce((s, c) => (c.year === y && pred(c) ? s + c.amount : s), 0);
  const nonZero = (xs: NamedAmount[]) => xs.filter((x) => x.amount !== 0);
  const isWork = (c: TableCell) => under(c.row, "cf.income.salary") || under(c.row, "cf.income.business");
  const known = ["cf.expense.living", "cf.expense.housing", "cf.expense.education", "cf.expense.insurance"];
  const income = nonZero([
    { label: "給与・事業の収入", amount: sum(isWork) },
    { label: "公的年金", amount: sum((c) => under(c.row, "cf.income.pension")) },
    { label: "その他の収入", amount: sum((c) => under(c.row, "cf.income") && !isWork(c) && !under(c.row, "cf.income.pension")) },
  ]);
  const expense = nonZero([
    { label: "基本生活費", amount: sum((c) => under(c.row, "cf.expense.living")) },
    { label: "住居費", amount: sum((c) => under(c.row, "cf.expense.housing")) },
    { label: "教育費", amount: sum((c) => under(c.row, "cf.expense.education")) },
    { label: "保険料", amount: sum((c) => under(c.row, "cf.expense.insurance")) },
    { label: "その他の支出", amount: sum((c) => under(c.row, "cf.expense") && !known.some((p) => under(c.row, p))) },
    { label: "税・社会保険料", amount: sum((c) => under(c.row, "cf.taxSi")) },
  ]);
  const by = ctx.baseYear;
  return {
    year,
    income,
    expense,
    net: sum((c) => c.row === "cf.net"),
    balanceYear: by,
    balance: sheetOf(t, [{ year: by, label: `${by}年末` }]),
  };
}

// ---- バランスシート（全資産・全負債。アプリの資産と負債の推移と同じ分け方: 不動産・その他の資産は金融資産の合計に入らない）----

const REAL_ESTATE_ROW = "cf.balance.account.realEstate";
/** その他の資産の行（保険の解約返戻金・車・その他の資産）。並びは帳票の行の順 */
const OTHER_ASSET_KINDS = ["car", "insurance", "otherAsset"];
const OTHER_ASSET_LABEL: Record<string, string> = { car: "車", insurance: "保険の解約返戻金", otherAsset: "その他の資産" };
/** 金融資産の器の並び（帳票の行の順） */
const FINANCIAL_KINDS = ["deposit", "fxDeposit", "zaikei", "taxable", "nisa", "childNisa", "juniorNisa", "legacyNisa", "ideco", "corporateDc", "esop", "smallBusinessMutualAid"];

/** 年末の時点ごとのバランスシート。金融資産の器のマイナス（預金の不足）は負債の側に出す。資産の合計＝負債の合計＋純資産 */
export function sheetOf(table: readonly TableCell[], points: readonly YearPoint[]): BalanceSheetView {
  const ys = points.map((p) => p.year);
  const at = (pred: (c: TableCell) => boolean): Yen[] => ys.map((y) => table.reduce((s, c) => (c.year === y && pred(c) ? s + c.amount : s), 0));
  const kindOf = (row: string) => row.slice("cf.balance.account.".length);
  const present = new Set(table.filter((c) => under(c.row, "cf.balance.account") && ys.includes(c.year)).map((c) => kindOf(c.row)));
  const isRealEstate = (k: string) => k === "realEstate" || k.startsWith("realEstate.");
  const finKinds = [...FINANCIAL_KINDS.filter((k) => present.has(k)), ...[...present].filter((k) => !FINANCIAL_KINDS.includes(k) && !OTHER_ASSET_KINDS.includes(k) && !isRealEstate(k)).sort()];
  const fin = finKinds.map((k) => ({ label: ACCOUNT_LABEL[k] ?? "その他の金融資産", values: at((c) => c.row === `cf.balance.account.${k}`) }));
  const pos = (v: Yen) => Math.max(0, v);
  const any = (xs: readonly Yen[]) => xs.some((v) => v !== 0);
  const finPos = ys.map((_, i) => fin.reduce((s, x) => s + pos(x.values[i] ?? 0), 0));
  const short = ys.map((_, i) => fin.reduce((s, x) => s + pos(-(x.values[i] ?? 0)), 0));
  // 不動産は土地と建物の行に分けて出る（中身の無い住まい以外の不動産は分けない1行）
  const realEstate = at((c) => under(c.row, REAL_ESTATE_ROW));
  const reParts = [
    { label: "土地", values: at((c) => c.row === `${REAL_ESTATE_ROW}.land`) },
    { label: "建物", values: at((c) => c.row === `${REAL_ESTATE_ROW}.building`) },
    { label: "土地と建物に分けていない不動産", values: at((c) => c.row === REAL_ESTATE_ROW) },
  ].filter((x) => any(x.values));
  const others = OTHER_ASSET_KINDS.map((k) => ({ label: OTHER_ASSET_LABEL[k] as string, values: at((c) => c.row === `cf.balance.account.${k}`) })).filter((x) => any(x.values));
  const totalAssets = ys.map((_, i) => (finPos[i] ?? 0) + (realEstate[i] ?? 0) + others.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const mortgage = at((c) => c.row === "cf.balance.debt.mortgage" || c.row === "cf.balance.debt.unpaidInterest");
  const otherDebt = at((c) => c.row === "cf.balance.debt.other");
  const debts = [
    { label: "住宅ローン", values: mortgage },
    { label: "その他の負債", values: otherDebt },
    { label: "預金の不足", values: short },
  ].filter((x) => any(x.values));
  const totalLiabilities = ys.map((_, i) => debts.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  return {
    points: [...points],
    assets: [
      { label: "金融資産", kind: "item", amounts: finPos },
      ...fin.filter((x) => any(x.values.map(pos))).map((x) => ({ label: x.label, kind: "sub" as const, amounts: x.values.map(pos) })),
      { label: "不動産", kind: "item", amounts: realEstate },
      ...reParts.map((x) => ({ label: x.label, kind: "sub" as const, amounts: x.values })),
      ...others.map((x) => ({ label: x.label, kind: "item" as const, amounts: x.values })),
      { label: "資産の合計", kind: "total", amounts: totalAssets },
    ],
    liabilities: [...debts.map((x) => ({ label: x.label, kind: "item" as const, amounts: x.values })), { label: "負債の合計", kind: "total", amounts: totalLiabilities }],
    netWorth: ys.map((_, i) => (totalAssets[i] ?? 0) - (totalLiabilities[i] ?? 0)),
  };
}

/** 純資産の推移（basis.years と同じ並び） */
const netWorthOf = (table: readonly TableCell[], years: readonly number[]): Yen[] => sheetOf(table, years.map((y) => ({ year: y, label: "" }))).netWorth;

/** 図に並べる時点の数の上限（紙の幅に収まる数。画面の「時点を並べる」と同じ 2〜4つ） */
const FIGURE_POINTS_MAX = 4;
/** 年の抜粋の表の列の数の上限（縦の紙に収まる数） */
const SHEET_POINTS_MAX = 5;

/** 本人の年齢つきの呼び方（本人がいなければ年） */
const whoOf = (ctx: Ctx) => (y: number): string => (ctx.self !== undefined ? `${ctx.self.label}${ageInYear(ctx.self.member, y)}歳` : `${y}年`);

/** 表の範囲の中（計算基準年の年末から表の最後の年まで）だけを、同じ年は先のものを残して並べる */
function keepPoints(ctx: Ctx, points: readonly YearPoint[], max: number): YearPoint[] {
  const last = ctx.years.at(-1) ?? ctx.baseYear;
  const kept: YearPoint[] = [];
  for (const p of points) if (p.year >= ctx.baseYear && p.year <= last && !kept.some((k) => k.year === p.year) && kept.length < max) kept.push(p);
  return kept.sort((a, b) => a.year - b.year);
}

/** 主な時点: 今（計算基準年の年末）・10年後・本人の退職の年・本人75歳 */
function standardPoints(ctx: Ctx): { now: YearPoint; ten: YearPoint; retire: YearPoint | null; age75: YearPoint | null } {
  const who = whoOf(ctx);
  const self = ctx.self;
  const ret = self !== undefined ? retirementMonth(ctx.bundle.proposal.request, self.member) : null;
  const y75 = self !== undefined ? parseYm(self.member.birth.birthYearMonth).y + 75 : null;
  return {
    now: { year: ctx.baseYear, label: "今" },
    ten: { year: ctx.baseYear + 10, label: `10年後（${who(ctx.baseYear + 10)}）` },
    retire: ret !== null ? { year: parseYm(ret).y, label: `退職の年（${who(parseYm(ret).y)}）` } : null,
    age75: y75 !== null ? { year: y75, label: who(y75) } : null,
  };
}

/**
 * バランスシートの図の時点。画面で並べている時点（bundle.balancePoints）があればそれ（2〜4つ）、
 * 無ければ今・退職の年・75歳（無い時点は10年後で埋める）。表の範囲の中だけ
 */
function figurePoints(ctx: Ctx): YearPoint[] {
  const who = whoOf(ctx);
  const given = ctx.bundle.balancePoints ?? [];
  // 時点の名前は見出しの呼び方にする: 今／年齢の時点と年を直に選んだ時点は「ご主人75歳」／それ以外は「退職の年（ご主人65歳）」
  const label = (year: number, name: string | null): string => (year === ctx.baseYear ? "今" : name === null || /^\d+歳$/.test(name) ? who(year) : `${name}（${who(year)}）`);
  const chosen = keepPoints(ctx, given.map((p) => ({ year: p.year, label: label(p.year, p.name) })), FIGURE_POINTS_MAX);
  if (chosen.length > 0) return chosen;
  const s = standardPoints(ctx);
  const out: YearPoint[] = [];
  for (const p of [s.now, s.retire, s.age75, s.ten]) if (p !== null && out.length < 3 && keepPoints(ctx, [...out, p], 3).length > out.length) out.push(p);
  return keepPoints(ctx, out, 3);
}

/**
 * バランスシートの年の抜粋（表）: 図の時点と目標の年を必ず入れ、5列に満たなければ10年後を足す
 * （図の時点が今・退職の年・75歳なら、今・10年後・退職の年・75歳・目標の年。表の範囲の中だけ。同じ年は1つ）
 */
function balancePoints(ctx: Ctx, figure: readonly YearPoint[]): YearPoint[] {
  const who = whoOf(ctx);
  const base = keepPoints(ctx, [...figure, { year: ctx.target.year, label: who(ctx.target.year) }], SHEET_POINTS_MAX);
  return keepPoints(ctx, [...base, standardPoints(ctx).ten], SHEET_POINTS_MAX);
}

/** バランスシートの図（提案。アプリの「資産と負債」のタブと同じ分け方。共通の縮尺） */
function balanceFigure(ctx: Ctx, points: readonly YearPoint[]): BalanceFigure {
  const h = ctx.bundle.proposal.request.input.household;
  const at = bsSeries(ctx.bundle.proposal.result.table, points.map((p) => p.year), { residences: h.residences ?? [], debts: (h.debts ?? []).map((d) => ({ id: d.id, kind: d.kind, ...(d.property !== undefined ? { property: d.property } : {}) })) });
  const box = (a: (typeof at)[number], g: BsGroup) => ({ key: g, label: BS_GROUP_LABEL[g], amount: groupTotal(a, g) });
  const line = (a: (typeof at)[number], key: string) => a.lines.filter((l) => l.key === key).reduce((s, l) => s + l.amount, 0);
  // 換金しにくい資産は、土地・建物・そのほか（車・保険の解約返戻金・分けていない不動産など）の箱に分ける（建物は年数とともに減り、土地は残る）
  const illiquid = (a: (typeof at)[number]) => {
    const land = line(a, "land");
    const building = line(a, "building");
    return [
      { key: "land", label: "土地", amount: land },
      { key: "building", label: "建物", amount: building },
      { key: "illiquidOther", label: "車・その他", amount: groupTotal(a, "illiquid") - land - building },
    ];
  };
  const columns = at.map((a, i) => ({
    point: points[i] as YearPoint,
    fact: a.year === ctx.baseYear,
    assets: [...(["liquid", "market", "locked"] as const).map((g) => box(a, g)), ...illiquid(a)].filter((b) => b.amount > 0),
    liabilities: [box(a, "mortgage"), box(a, "debt"), { key: "netWorth", label: "純資産", amount: Math.max(0, a.netWorth) }].filter((b) => b.amount > 0),
    negative: Math.max(0, -a.netWorth),
    totalAssets: a.totalAssets,
    totalLiabilities: a.totalLiabilities,
    netWorth: a.netWorth,
    financial: a.financial,
  }));
  return { scale: Math.max(1, ...columns.map((c) => Math.max(c.totalAssets, c.totalLiabilities))), columns };
}

function balanceSheet(ctx: Ctx): NonNullable<ProposalInput["balanceSheet"]> {
  const figure = figurePoints(ctx);
  const points = balancePoints(ctx, figure);
  const cur = ctx.bundle.current.result.table;
  const prop = ctx.bundle.proposal.result.table;
  return {
    figure: balanceFigure(ctx, figure),
    proposal: sheetOf(prop, points),
    currentNetWorth: sheetOf(cur, points).netWorth,
    netWorth: { current: netWorthOf(cur, ctx.years), proposal: netWorthOf(prop, ctx.years) },
  };
}

function trimYears(maps: Map<number, number>[], years: readonly number[]): number[] {
  const active = years.filter((y) => maps.some((m) => (m.get(y) ?? 0) !== 0));
  if (active.length === 0) return [];
  const a = active[0] as number;
  const b = active.at(-1) as number;
  return years.filter((y) => y >= a && y <= b);
}

function education(ctx: Ctx): ProposalInput["education"] {
  const t = ctx.bundle.proposal.result.table;
  const kids = ctx.rs.filter((r) => r.member.kind === "child");
  const maps = kids.map((r) => ({ r, m: sumByYear(t, (c) => under(c.row, "cf.expense.education") && c.member === r.member.id) }));
  const other = sumByYear(t, (c) => under(c.row, "cf.expense.education") && !kids.some((k) => k.member.id === c.member));
  const all = sumByYear(t, (c) => under(c.row, "cf.expense.education"));
  const years = trimYears([all], ctx.years);
  if (years.length === 0) return null;
  const rows = maps.filter((x) => total(x.m, years) !== 0).map((x) => ({ label: x.r.label, amounts: seriesOf(x.m, years), total: total(x.m, years) }));
  if (total(other, years) !== 0) rows.push({ label: "その他", amounts: seriesOf(other, years), total: total(other, years) });
  return { years, rows, total: seriesOf(all, years), grandTotal: total(all, years) };
}

function housingLoan(ctx: Ctx): ProposalInput["housingLoan"] {
  const isBal = (c: TableCell) => c.row === "cf.balance.debt.mortgage" || c.row === "cf.balance.debt.unpaidInterest";
  const isPay = (c: TableCell) => under(c.row, "cf.expense.housing.loan");
  const p = ctx.bundle.proposal.result.table;
  const bal = sumByYear(p, isBal);
  const pay = sumByYear(p, isPay);
  const years = trimYears([bal, pay], ctx.years);
  if (years.length === 0) return null;
  const compare = (label: string, run: Run) => {
    const m = sumByYear(run.result.table, isPay);
    const paid = [...m.entries()].filter(([, v]) => v > 0).map(([y]) => y).sort((a, b) => a - b).at(-1);
    return { label, payoff: paid === undefined || paid >= ctx.bundle.proposal.request.input.endYear ? null : { year: paid, label: pointLabel(ctx, paid) }, totalRepayment: total(m, ctx.years) };
  };
  const c = compare("現状", ctx.bundle.current);
  const q = compare("提案", ctx.bundle.proposal);
  return { years, balance: seriesOf(bal, years), repayment: seriesOf(pay, years), compare: [c, q], effect: c.totalRepayment === q.totalRepayment ? null : q.totalRepayment - c.totalRepayment };
}

const isOldAgePension = (c: TableCell) => under(c.row, "cf.income.pension") && !under(c.row, "cf.income.pension.survivor") && !under(c.row, "cf.income.pension.disability");

function retirement(ctx: Ctx): ProposalInput["retirement"] {
  const run = ctx.bundle.proposal;
  const adults = ctx.rs.filter((r) => r.key === "self" || r.key === "spouse");
  const maps = adults.map((r) => ({ r, m: sumByYear(run.result.table, (c) => isOldAgePension(c) && c.member === r.member.id) }));
  if (maps.every((x) => total(x.m, ctx.years) === 0)) return null;
  const pensions = maps.map(({ r, m }) => {
    const start = ctx.years.find((y) => (m.get(y) ?? 0) > 0);
    return {
      label: r.label,
      start: start === undefined ? null : { year: start, label: `${r.label}${ageInYear(r.member, start)}歳（${start}年）` },
      annual: start === undefined ? null : (m.get(start + 1) ?? m.get(start) ?? null),
      total: total(m, ctx.years),
    };
  });
  const all = sumByYear(run.result.table, isOldAgePension);
  const years = trimYears([all], ctx.years);
  const ageText = (y: number) => adults.filter((r) => presentIn(r, y)).map((r) => `${r.label}${ageInYear(r.member, y)}歳`).join("・");
  const table: YearTable = {
    columns: [...adults.map((r) => `${r.label}の年金`), "世帯の合計"],
    rows: years.map((y) => ({ year: y, ages: ageText(y), cells: [...maps.map((x) => x.m.get(y) ?? 0), all.get(y) ?? 0] })),
  };
  const finP = financialOf(run.result);
  const finC = financialOf(ctx.bundle.current.result);
  const atRetirement: { label: string; current: Yen; proposal: Yen }[] = [];
  for (const r of adults) {
    const ret = retirementMonth(run.request, r.member);
    if (ret === null) continue;
    const y = parseYm(ret).y;
    if (!ctx.years.includes(y)) continue;
    atRetirement.push({ label: `${r.label}の退職の年（${y}年・${ageAt(r.member, ret)}歳）`, current: finC.get(y) ?? 0, proposal: finP.get(y) ?? 0 });
  }
  let afterRetirement: NonNullable<ProposalInput["retirement"]>["afterRetirement"] = null;
  const selfRet = ctx.self !== undefined ? retirementMonth(run.request, ctx.self.member) : null;
  if (selfRet !== null) {
    const from = parseYm(selfRet).y + 1;
    const ys = ctx.years.filter((y) => y >= from);
    if (ys.length > 0) {
      const income = total(sumByYear(run.result.table, (c) => under(c.row, "cf.income")), ys);
      const spending = total(sumByYear(run.result.table, (c) => under(c.row, "cf.expense") || under(c.row, "cf.taxSi")), ys);
      afterRetirement = { from, income, spending, gap: income - spending };
    }
  }
  let deferral: NonNullable<ProposalInput["retirement"]>["deferral"] = null;
  const d = ctx.bundle.deferral;
  if (d !== undefined) {
    const who = ctx.rs.find((r) => r.key === d.memberKey);
    if (who !== undefined) {
      const upTo = ctx.years.filter((y) => y <= ctx.target.year);
      deferral = {
        label: who.label,
        options: d.options.map((o) => {
          const m = sumByYear(o.run.result.table, (c) => isOldAgePension(c) && c.member === who.member.id);
          const start = ctx.years.find((y) => (m.get(y) ?? 0) > 0);
          return {
            label: `${o.startAge}歳から受け取る`,
            annual: start === undefined ? null : (m.get(start + 1) ?? m.get(start) ?? null),
            totalToTarget: total(m, upTo),
            financialAtTarget: financialOf(o.run.result).get(ctx.target.year) ?? 0,
          };
        }),
      };
    }
  }
  return { pensions, table, atRetirement, afterRetirement, deferral };
}

const REFORM_NOTICE = "N_REFORM_NOT_REFLECTED";
const REFORM_TEXT = "遺族年金は2028年4月の見直し前の制度で計算しています（2028年4月以後に亡くなる想定）";
const hasReform = (r: EngineOutput) => (r.header.notices ?? []).some((n) => n.code === REFORM_NOTICE);

function contingency(ctx: Ctx): ProposalInput["contingency"] {
  const scenarios: ScenarioView[] = [];
  const base = ctx.bundle.proposal.result;
  const finBase = financialOf(base);
  const groups: { label: string; match: (c: TableCell) => boolean }[] = [
    { label: "給与・事業の収入", match: (c) => under(c.row, "cf.income.salary") || under(c.row, "cf.income.business") },
    { label: "公的年金（遺族年金を含む）", match: (c) => under(c.row, "cf.income.pension") },
    { label: "保険金・一時金", match: (c) => under(c.row, "cf.income.lumpSum") || under(c.row, "cf.income.other") },
    { label: "その他の収入", match: (c) => under(c.row, "cf.income") && !["cf.income.salary", "cf.income.business", "cf.income.pension", "cf.income.lumpSum", "cf.income.other"].some((p) => under(c.row, p)) },
    { label: "基本生活費", match: (c) => under(c.row, "cf.expense.living") },
    { label: "住居費", match: (c) => under(c.row, "cf.expense.housing") },
    { label: "教育費", match: (c) => under(c.row, "cf.expense.education") },
    { label: "その他の支出", match: (c) => under(c.row, "cf.expense") && !["cf.expense.living", "cf.expense.housing", "cf.expense.education"].some((p) => under(c.row, p)) },
    { label: "税・社会保険料", match: (c) => under(c.row, "cf.taxSi") },
  ];
  for (const s of ctx.bundle.contingencies ?? []) {
    const r = s.run.result;
    const fin = financialOf(r);
    const dep = depletionYear(r, ctx.years);
    const surv = sumByYear(r.table, (c) => under(c.row, "cf.income.pension.survivor"));
    const breakdown = groups
      .map((g) => ({ label: g.label, amount: total(sumByYear(r.table, g.match), ctx.years) - total(sumByYear(base.table, g.match), ctx.years) }))
      .filter((b) => b.amount !== 0);
    scenarios.push({
      title: s.title,
      withEvent: seriesOf(fin, ctx.years),
      withoutEvent: seriesOf(finBase, ctx.years),
      depletion: dep === null ? null : { year: dep, label: pointLabel(ctx, dep) },
      survivorPension: ctx.years.filter((y) => (surv.get(y) ?? 0) !== 0).map((y) => ({ year: y, amount: surv.get(y) ?? 0 })),
      survivorPensionTotal: total(surv, ctx.years),
      breakdown,
      notices: hasReform(r) && (s.run.request.input.contingencies ?? []).some((c) => c.kind === "death") ? [REFORM_TEXT] : [],
    });
  }
  const protection: ProtectionView[] = [];
  const pr = ctx.bundle.protection;
  if (pr?.result.protection !== undefined) {
    const kind = pr.request.input.protection?.horizon?.kind ?? "lifeExpectancy";
    for (const m of pr.result.protection.members) {
      const who = ctx.rs.find((r) => r.member.id === m.member);
      if (who === undefined || m.years.length === 0) continue;
      const surv = ctx.rs.find((r) => r.member.id === m.survivor);
      const until = kind === "youngestIndependence" ? "末子の独立" : kind === "age" ? `${surv?.label ?? "ご家族"}が${pr.request.input.protection?.horizon?.age ?? ""}歳` : `${surv?.label ?? "ご家族"}の平均余命`;
      let maxShort: ProtectionView["maxShort"] = null;
      for (const y of m.years) {
        const short = y.needWithAssets - y.coverage;
        if (short > 0 && (maxShort === null || short > maxShort.amount)) maxShort = { year: y.year, amount: short };
      }
      const horizon = m.years[0]?.horizon;
      protection.push({
        title: `${who.label}が亡くなった場合`,
        sub: `${until}${horizon !== undefined ? `（${horizon}年）` : ""}までの資金。遺族は${surv?.label ?? "お子さま"}`,
        years: m.years.map((y) => y.year),
        need: m.years.map((y) => y.need),
        needWithAssets: m.years.map((y) => y.needWithAssets),
        coverage: m.years.map((y) => y.coverage),
        maxShort,
      });
    }
  }
  if (scenarios.length === 0 && protection.length === 0) return null;
  return { scenarios, protection };
}

function premiumText(p: Household["insuranceContracts"][number]["premium"]): string {
  const head = p.frequency === "monthly" ? "月額" : p.frequency === "annual" ? "年額" : "一時払";
  const until = atOf(p.payUntil);
  return `${head}${yenText(p.amount)}${until !== null ? `（${monthLabel(until)}まで）` : ""}`;
}

function insurance(ctx: Ctx): ProposalInput["insurance"] {
  const cur = ctx.bundle.current.request.input.household.insuranceContracts;
  const pro = ctx.bundle.proposal.request.input.household.insuranceContracts;
  if (cur.length === 0 && pro.length === 0) return null;
  const label = new Map(ctx.rs.map((r) => [r.member.id, r.label]));
  const curIds = new Set(cur.map((c) => c.id));
  const proIds = new Set(pro.map((c) => c.id));
  const all = [...pro, ...cur.filter((c) => !proIds.has(c.id))];
  const names = all.map((c) => INSURANCE_LABEL[c.template] ?? "保険");
  const display = all.map((c, i) => {
    const n = names[i] as string;
    return names.filter((x) => x === n).length > 1 ? `${n}（${label.get(c.insured) ?? "ご家族"}）` : n;
  });
  const contracts = all.map((c, i) => ({
    label: display[i] as string,
    insured: label.get(c.insured) ?? "ご家族",
    premium: premiumText(c.premium),
    benefits: (c.coverages ?? []).map((v) => `${BENEFIT_LABEL[v.benefit] ?? "給付"} ${yenText(v.amount)}`),
    status: (curIds.has(c.id) && proIds.has(c.id) ? "継続" : proIds.has(c.id) ? "新規" : "解約") as "継続" | "新規" | "解約",
  }));
  const isIns = (c: TableCell) => under(c.row, "cf.expense.insurance");
  const pT = ctx.bundle.proposal.result.table;
  const perContract = pro.map((c) => sumByYear(pT, (x) => isIns(x) && x.object === c.id));
  const totalP = sumByYear(pT, isIns);
  const totalC = sumByYear(ctx.bundle.current.result.table, isIns);
  const years = trimYears([totalP, totalC], ctx.years);
  const shown = pro.map((_, i) => i).filter((i) => total(perContract[i] as Map<number, number>, years) !== 0);
  const adults = ctx.rs.filter((r) => r.key === "self" || r.key === "spouse");
  const table: YearTable = {
    columns: [...shown.map((i) => display[i] as string), "合計（提案）", "合計（現状）"],
    rows: years.map((y) => ({
      year: y,
      ages: adults.filter((r) => presentIn(r, y)).map((r) => `${r.label}${ageInYear(r.member, y)}歳`).join("・"),
      cells: [...shown.map((i) => (perContract[i] as Map<number, number>).get(y) ?? 0), totalP.get(y) ?? 0, totalC.get(y) ?? 0],
    })),
  };
  return { contracts, table, total: { current: total(totalC, ctx.years), proposal: total(totalP, ctx.years) } };
}

/** FP顧問料の料金の段階の文（例: 「2030年1月から月15,000円、2033年1月から月20,000円」）。段階が無ければ null */
function stepsText(steps: readonly { at: Parameters<typeof atOf>[0]; annual?: number; monthly?: number }[], per: "年" | "月"): string | null {
  const parts = steps.flatMap((st) => {
    const at = atOf(st.at);
    const amount = st.annual ?? st.monthly;
    return at === null || amount === undefined ? [] : [`${monthLabel(at)}から${per}${yenText(amount)}`];
  });
  return parts.length > 0 ? parts.join("、") : null;
}

function advisoryFeeAssumption(ctx: Ctx): ProposalInput["assumptions"]["advisoryFee"] {
  const fee = ctx.bundle.proposal.result.summary.advisoryFee;
  if (fee === undefined || fee.total === 0) return null;
  const contracts = (ctx.bundle.proposal.request.input.household.advisoryFees ?? [])
    .filter((f) => f.enabled !== false)
    .map((f) => {
      const rec = f.terms?.recurring;
      const from = atOf(rec?.from ?? null);
      const to = atOf(rec?.to ?? null);
      return {
        label: f.menu?.label ?? "FP顧問料",
        oneTime: (f.terms?.oneTime ?? []).flatMap((o) => {
          const at = atOf(o.at);
          return at === null ? [] : [{ month: monthLabel(at), amount: o.amount }];
        }),
        recurring:
          rec === undefined
            ? null
            : {
                amount: rec.annual ?? rec.monthly ?? 0,
                per: (rec.annual !== undefined ? "year" : "month") as "year" | "month",
                from: from !== null ? monthLabel(from) : "契約の時点",
                to: to !== null ? monthLabel(to) : null,
                // 改定は料金の段階の額だけを書く（「2030年1月から月15,000円」）。値上げの率は顧客に見せない（計算には入っている）
                revision: stepsText(rec.revision?.steps ?? [], rec.annual !== undefined ? "年" : "月"),
              },
      };
    });
  const paid = fee.byYear.filter((b) => b.amount > 0).map((b) => b.year);
  return { contracts, total: fee.total, firstYear: paid[0] ?? null, lastYear: paid.at(-1) ?? null };
}

/** 黒字のうち貯まる割合の文（例: 「60%（黒字の年だけ。貯まらない分は「ゆとりの支出」）」。入れていなければ null。0031） */
export function surplusText(s: EngineRequest["input"]["assumptions"]["surplusSaving"]): string | null {
  if (s === undefined) return null;
  const one = (r: { ratio?: string; cap?: number }) => [r.ratio !== undefined ? percent(r.ratio) : "", r.cap !== undefined ? `年${group(Math.round(r.cap / 10000))}万円まで` : ""].filter((x) => x !== "").join("・");
  const head = one(s);
  const changes = (s.changes ?? []).map((c) => `${"at" in c.from ? `${c.from.at.slice(0, 4)}年` : "memberAge" in c.from ? `${c.from.memberAge.years}歳` : "途中"}から${one(c) || "100%"}`);
  if (head === "" && changes.length === 0) return null;
  return `${[head || "100%", ...changes].join("、")}（黒字の年だけ。貯まらない分は「ゆとりの支出」として支出に入れています）`;
}

function assumptions(ctx: Ctx): ProposalInput["assumptions"] {
  const a = ctx.bundle.proposal.request.input.assumptions;
  const rates: { label: string; value: string }[] = [];
  const rate = (label: string, s: { default: string; byYear?: Readonly<Record<string, string>> } | undefined) => {
    if (s === undefined) return;
    rates.push({ label, value: `年${percent(s.default)}${s.byYear !== undefined && Object.keys(s.byYear).length > 0 ? "（年により変わる）" : ""}` });
  };
  rate("運用利回り（資産の器ごとの指定が無いもの）", a.investmentReturn);
  for (const [k, v] of Object.entries(a.assetReturns ?? {})) rate(`運用利回り（${k}）`, v);
  rate("物価上昇率", a.inflation);
  rate("賃金上昇率", a.wageGrowth);
  rate("教育費の上昇率", a.educationInflation);
  rate("公的年金の調整率（マクロ経済スライド）", a.pensionMacroSlide);
  // 黒字のうち貯まる割合（0031）
  const surplus = surplusText(a.surplusSaving);
  if (surplus !== null) rates.push({ label: "黒字のうち貯まる割合", value: surplus });
  const dataSet = (ctx.bundle.proposal.result.header.data ?? []).map((d) => ({ label: PACK_LABEL[d.packId] ?? d.packId, version: d.version, fictional: d.fictional === true }));
  let survivor: ProposalInput["assumptions"]["survivor"] = null;
  const hasContingency = (ctx.bundle.contingencies ?? []).length > 0 || ctx.bundle.protection !== undefined;
  if (hasContingency) {
    const given =
      (ctx.bundle.contingencies ?? []).map((c) => c.run.request.input.contingencies?.[0]?.survivor?.livingRatio).find((x) => x !== undefined) ??
      ctx.bundle.protection?.request.input.protection?.survivor?.livingRatio;
    survivor = {
      beforeIndependence: percent(given?.beforeIndependence ?? SURVIVOR_DEFAULT.beforeIndependence),
      afterIndependence: percent(given?.afterIndependence ?? SURVIVOR_DEFAULT.afterIndependence),
      noChildren: percent(given?.noChildren ?? SURVIVOR_DEFAULT.noChildren),
      source: given !== undefined ? "input" : "default",
    };
  }
  const reform = [...(ctx.bundle.contingencies ?? []).map((c) => c.run), ...(ctx.bundle.protection !== undefined ? [ctx.bundle.protection] : [])].some((r) => hasReform(r.result));
  const advisoryFee = advisoryFeeAssumption(ctx);
  const notes: string[] = [];
  if (advisoryFee !== null) notes.push("ご本人が払うFP顧問料は、所得から差し引かない扱いで計算しています。");
  // 推定の値: どの欄かは書かない（FP 向けの画面だけで示す）
  if (ctx.bundle.estimated === true || hasEstimatedBox(ctx.bundle.current.request.input.household) || hasEstimatedBox(ctx.bundle.proposal.request.input.household)) notes.push(ESTIMATED_NOTE);
  return { rates, dataSet, survivor, survivorReform: reform, advisoryFee, notes };
}

/** 推定の値があるときの注意書き（提案書にはこの一文だけを書く） */
export const ESTIMATED_NOTE = "一部は統計の平均で補っています。";

/** 値の箱（0008 の2）のうち、推定（統計などで補った値）のものがあるか */
export function hasEstimatedBox(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasEstimatedBox);
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.state === "estimated" && "value" in o) return true;
  return Object.values(o).some(hasEstimatedBox);
}

function changes(ctx: Ctx, current: Outcome, proposal: Outcome): ProposalInput["changes"] {
  const b = ctx.bundle;
  const diff = (c: number | null, p: number | null) => (c === null || p === null ? null : p - c);
  const yen = (label: string, c: number, p: number) => ({ label, unit: "yen" as const, current: c, proposal: p, diff: p - c });
  const metrics: ProposalInput["changes"]["metrics"] = [
    yen(`${ctx.target.label}の金融資産`, current.financialAtTarget, proposal.financialAtTarget),
    { label: "金融資産が不足する年", unit: "year", current: current.depletion?.year ?? null, proposal: proposal.depletion?.year ?? null, diff: diff(current.depletion?.year ?? null, proposal.depletion?.year ?? null) },
    yen("収入の合計（表の期間）", current.totals.income, proposal.totals.income),
    yen("税・社会保険料の合計", current.totals.taxSi, proposal.totals.taxSi),
    yen("支出の合計", current.totals.expense, proposal.totals.expense),
    yen("年間収支の合計", current.totals.net, proposal.totals.net),
  ];
  // FP顧問料の累計の額は、この章には出さない（結果の画面の一文と同じ扱い。顧問料の額は「前提条件と注意書き」の章にある）
  const finC = current.financialAtTarget;
  const finAt = (r: Run) => financialOf(r.result).get(ctx.target.year) ?? 0;
  let fee: ProposalInput["changes"]["fee"] = null;
  const af = b.proposal.result.summary.advisoryFee;
  if (af !== undefined && af.total !== 0) {
    fee = {
      total: af.total,
      totalToTarget: af.byYear.filter((x) => x.year <= ctx.target.year).at(-1)?.cumulative ?? 0,
      diffAtTarget: proposal.financialAtTarget - finC,
      diffWithoutFee: b.proposalWithoutFee !== undefined ? finAt(b.proposalWithoutFee) - finC : null,
    };
  }
  let steps: ProposalInput["changes"]["steps"] = null;
  let excludingInvestment: Yen | null = b.excludingInvestment !== undefined ? finAt(b.excludingInvestment) - finC : null;
  if (b.steps !== undefined && b.steps.length > 0) {
    let prev = finC;
    steps = b.steps.map((s) => {
      const v = finAt(s.run);
      const out = { label: s.label, investment: s.investment === true, effect: v - prev, cumulative: v - finC };
      prev = v;
      return out;
    });
    if (excludingInvestment === null) {
      // 運用の前提の変更が最後にまとまっているときだけ、その手前の累計を「運用の前提の変更を除いた効果」とする
      const firstInv = steps.findIndex((s) => s.investment);
      if (firstInv === -1) excludingInvestment = steps.at(-1)?.cumulative ?? null;
      else if (steps.slice(firstInv).every((s) => s.investment)) excludingInvestment = firstInv === 0 ? 0 : (steps[firstInv - 1]?.cumulative ?? null);
    }
  }
  return { metrics, items: b.changes ?? [], fee, steps, excludingInvestment };
}

/** 案の主な数字（主画面の比較の表 app/src/workspace/plans/compare.ts の metricsOf と同じ決め方） */
export interface ComparisonMetrics {
  target: Yen;
  depletion: number | null;
  /** 生涯の手取りの合計（収入−税・社会保険料。表に出す年の合計） */
  takeHome: Yen;
  /** 生涯の支出の合計（税・社会保険料を除く） */
  expense: Yen;
  min: { year: number; amount: Yen };
  /** 住宅ローンの返済の合計（繰上返済・手数料を含む） */
  loan: Yen;
}

export function comparisonMetrics(run: Run, years: readonly number[], targetYear: number): ComparisonMetrics {
  const ys = new Set(years);
  const fin = financialOf(run.result);
  let takeHome = 0;
  let expense = 0;
  let loan = 0;
  for (const c of run.result.table) {
    if (!ys.has(c.year)) continue;
    if (under(c.row, "cf.income")) takeHome += c.amount;
    else if (under(c.row, "cf.taxSi")) takeHome -= c.amount;
    else if (under(c.row, "cf.expense")) {
      expense += c.amount;
      if (under(c.row, "cf.expense.housing.loan")) loan += c.amount;
    }
  }
  let min = { year: years[0] ?? run.request.input.endYear, amount: Number.POSITIVE_INFINITY };
  for (const y of years) {
    const v = fin.get(y) ?? 0;
    if (v < min.amount) min = { year: y, amount: v };
  }
  if (!Number.isFinite(min.amount)) min = { ...min, amount: 0 };
  return { target: fin.get(targetYear) ?? 0, depletion: depletionYear(run.result, years), takeHome, expense, min, loan };
}

function comparison(ctx: Ctx): Comparison | null {
  const c = ctx.bundle.comparison;
  if (c === undefined || c.plans.length < 2) return null;
  const plans = c.plans.slice(0, 6);
  const b = Math.min(Math.max(0, c.base), plans.length - 1);
  const ms = plans.map((p) => comparisonMetrics(p.run, ctx.years, ctx.target.year));
  const bm = ms[b] as ComparisonMetrics;
  const yenRow = (key: "target" | "takeHome" | "expense" | "loan", label: string, get: (m: ComparisonMetrics) => number): Comparison["rows"][number] => ({
    key,
    label,
    unit: "yen",
    values: ms.map(get),
    years: [],
    diffs: ms.map((m, i) => (i === b ? null : get(m) - get(bm))),
  });
  const rows: Comparison["rows"] = [
    yenRow("target", `${ctx.target.label}時点の金融資産`, (m) => m.target),
    {
      key: "depletion",
      label: "資産が尽きる年",
      unit: "year",
      values: ms.map((m) => m.depletion),
      years: [],
      diffs: ms.map((m, i) => (i === b || m.depletion === null || bm.depletion === null ? null : m.depletion - bm.depletion)),
    },
    yenRow("takeHome", "生涯の手取りの合計", (m) => m.takeHome),
    yenRow("expense", "生涯の支出の合計（税・社会保険料を除く）", (m) => m.expense),
    { key: "min", label: "金融資産がいちばん少ない年", unit: "yen", values: ms.map((m) => m.min.amount), years: ms.map((m) => m.min.year), diffs: ms.map((m, i) => (i === b ? null : m.min.amount - bm.min.amount)) },
  ];
  if (ms.some((m) => m.loan > 0)) rows.push(yenRow("loan", "住宅ローンの返済の合計（繰上返済を含む）", (m) => m.loan));
  return { target: ctx.target, base: b, columns: plans.map((p) => ({ letter: p.letter, name: p.name })), rows };
}

/** 計算の要求と正の計算の結果から、帳票の入力を組み立てる */
// ---- 資産運用の計画・相場が下がった場合（0026。アプリの資産の推移と同じまとめ方）----

/** 口座の内訳のまとまり（下から積む順。アプリの workspace/invest/present.ts と同じ） */
const INVEST_GROUPS: readonly { label: string; color: string; kinds: readonly string[] }[] = [
  { label: "預金", color: "#cad2dd", kinds: ["deposit", "fxDeposit", "zaikei"] },
  { label: "まだ分けていない", color: "#ddd6e8", kinds: ["pooled"] },
  { label: "iDeCo・企業型DC", color: "#a8c59e", kinds: ["ideco", "corporateDc"] },
  { label: "NISA", color: "#8ea7d5", kinds: ["nisa", "childNisa", "juniorNisa", "legacyNisa"] },
  { label: "課税口座など", color: "#e2cd9b", kinds: ["taxable", "esop", "smallBusinessMutualAid"] },
];
const NOT_FINANCIAL_KINDS = new Set(["realEstate", "insurance", "car", "otherAsset"]);
const kindOfRow = (row: string): string | null => (row.startsWith("cf.balance.account.") ? row.slice("cf.balance.account.".length) : null);

/** 何歳まで持つか（尽きる年の前の年。尽きなければ表の最後の年）の文 */
function lastsText(ctx: Ctx, r: EngineOutput): string {
  if (ctx.self === undefined || ctx.years.length === 0) return "";
  const dep = depletionYear(r, ctx.years);
  return `${ageInYear(ctx.self.member, dep === null ? (ctx.years.at(-1) as number) : dep - 1)}歳まで持つ`;
}

/** その年の口座ごとの内訳（0以下は除く） */
function accountMix(r: EngineOutput, year: number): ColoredAmount[] {
  return INVEST_GROUPS.map((g) => ({
    label: g.label,
    color: g.color,
    amount: r.table.filter((c) => c.year === year && c.amount > 0 && g.kinds.includes(kindOfRow(c.row) ?? "")).reduce((x, c) => x + c.amount, 0),
  })).filter((x) => x.amount > 0);
}

function investment(ctx: Ctx): InvestmentView | null {
  const m = ctx.bundle.investment;
  if (m === undefined) return null;
  const p = ctx.bundle.proposal.result;
  const accounts = INVEST_GROUPS.map((g) => ({
    label: g.label,
    color: g.color,
    values: ctx.years.map((y) => Math.max(0, p.table.filter((c) => c.year === y && g.kinds.includes(kindOfRow(c.row) ?? "") && !NOT_FINANCIAL_KINDS.has(kindOfRow(c.row) ?? "")).reduce((x, c) => x + c.amount, 0))),
  })).filter((x) => x.values.some((v) => v > 0));
  const year = ctx.years.includes(m.donutYear) ? m.donutYear : (ctx.years.at(-1) ?? m.donutYear);
  return {
    method: m.method,
    condition: m.condition,
    lasts: { current: lastsText(ctx, ctx.bundle.current.result), proposal: lastsText(ctx, p) },
    periods: { ...m.periods, steps: m.periods.steps.map((x) => ({ ...x })) },
    accounts,
    donut: { year, label: pointLabel(ctx, year), current: accountMix(ctx.bundle.current.result, year), proposal: accountMix(p, year) },
  };
}

function marketDrop(ctx: Ctx): MarketDropView | null {
  const st = ctx.bundle.investment?.stress;
  if (st === undefined || st.length === 0) return null;
  return {
    proposal: seriesOf(financialOf(ctx.bundle.proposal.result), ctx.years),
    lasts: lastsText(ctx, ctx.bundle.proposal.result),
    lines: st.map((x) => ({ label: x.label, lasts: lastsText(ctx, x.run.result), values: seriesOf(financialOf(x.run.result), ctx.years) })),
  };
}

/** お金の3つの分け方（提案のプランの今の時点。説明用の図。0032）。出せないときは null */
function moneyThreeOf(ctx: Ctx): MoneyThreeModel | null {
  try {
    return moneyThreeModel({ req: ctx.bundle.proposal.request, table: ctx.bundle.proposal.result.table, settings: ctx.bundle.moneyThree ?? DEFAULT_MONEY_THREE });
  } catch {
    return null;
  }
}

export function buildProposalInput(bundle: ProposalBundle): ProposalInput {
  const req = bundle.proposal.request;
  const years = displayYears(req);
  const rs = roles(req);
  const self = rs.find((r) => r.key === "self");
  const lastYear = years.at(-1) ?? req.input.endYear;
  const targetYear = self !== undefined && bundle.targetAge !== undefined ? Math.min(lastYear, parseYm(self.member.birth.birthYearMonth).y + bundle.targetAge) : lastYear;
  const baseYear = parseYm(req.input.baseMonth).y;
  const ctx: Ctx = { bundle, years, rs, self, baseYear, target: { year: targetYear, label: "" } };
  ctx.target = { year: targetYear, label: pointLabel(ctx, targetYear) };
  const current = outcome(ctx, bundle.current);
  const proposal = outcome(ctx, bundle.proposal);
  const input: ProposalInput = {
    format: PROPOSAL_INPUT_FORMAT,
    version: PROPOSAL_INPUT_VERSION,
    document: { title: bundle.document.title ?? "ライフプランのご提案", issuedOn: bundle.document.issuedOn, preparedBy: bundle.document.preparedBy ?? null },
    basis: { baseMonth: req.input.baseMonth, baseMonthLabel: monthLabel(req.input.baseMonth), years },
    members: rs.map((r) => ({ key: r.key, label: r.label, ageAtBase: ageAt(r.member, req.input.baseMonth), ages: years.map((y) => (presentIn(r, y) ? ageInYear(r.member, y) : null)) })),
    assumptions: assumptions(ctx),
    summary: {
      target: ctx.target,
      current,
      proposal,
      diffAtTarget: proposal.financialAtTarget - current.financialAtTarget,
      depletionShift: current.depletion !== null && proposal.depletion !== null ? proposal.depletion.year - current.depletion.year : null,
    },
    basics: basics(ctx),
    events: events(ctx),
    cashflow: { current: cashflowTable(bundle.current, years, "キャッシュフロー表（現状）"), proposal: cashflowTable(bundle.proposal, years, "キャッシュフロー表（提案）") },
    assets: { current: seriesOf(financialOf(bundle.current.result), years), proposal: seriesOf(financialOf(bundle.proposal.result), years) },
    balanceSheet: balanceSheet(ctx),
    education: education(ctx),
    housingLoan: housingLoan(ctx),
    retirement: retirement(ctx),
    contingency: contingency(ctx),
    insurance: insurance(ctx),
    changes: changes(ctx, current, proposal),
    comparison: comparison(ctx),
    investment: investment(ctx),
    marketDrop: marketDrop(ctx),
    moneyThree: moneyThreeOf(ctx),
    layout: { ...DEFAULT_LAYOUT, ...bundle.layout },
  };
  return bundle.chapters !== undefined ? selectChapters(input, bundle.chapters) : input;
}
