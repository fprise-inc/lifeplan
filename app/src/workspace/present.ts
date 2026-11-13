// 計算結果と世帯から、提示用の値（PresentationModel。0016 の2）を作る。許可した項目だけを選んで写す
import type { EngineRequest, PreviewResult, TableCell } from "../engine/types.ts";
import type { AgeAxisRow, CashflowTableModel, ChartModel, Depletion, EventChip, EventIcon, FeeLine, FlowChartModel, Headline, PresentationModel, ResultVerdict, SeriesNames, StackSeries, TableRowModel, Verdict, VerdictPart, YearDetail } from "../presentation/model.ts";
import { man } from "../presentation/format.ts";
import { addMonths, ageReachedMonth, parseYm, readLevers } from "./levers.ts";
import { ageInYear, leaveYear, nameWithAge, presentInYear, roles, type Role } from "./roles.ts";
import { DEFICIT_NOTE, deficitSources, OUTSIDE_INCOME_NOTE, outsideName } from "./resultRows.ts";
import { resolveTimepoint } from "./timepoint.ts";
import { ROW_NAMES, rowName, type OfficeRowNames } from "../../../report/src/rowNames.ts";
import { OFFICIAL_WORDING, type Wording } from "./resultTexts.ts";
import { childScholarshipNotes } from "../../../report/src/childScholarships.ts";

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");
/** ゆとりの支出の行（黒字のうち貯まらない分。0031） */
export const SURPLUS_ROW = "cf.expense.living.surplus";

/** 表に出す年: 計算基準月が年の途中なら翌年から（その年は数か月分しかないため）、表の最後の年まで */
export function displayYears(req: EngineRequest): number[] {
  const { y, m } = parseYm(req.input.baseMonth);
  const out: number[] = [];
  for (let year = m > 1 ? y + 1 : y; year <= req.input.endYear; year++) out.push(year);
  return out;
}

/** 本人の、表の最初の年の年齢（本人がいない・表に年が無いときは null） */
export function firstAgeOf(req: EngineRequest): number | null {
  const first = displayYears(req)[0];
  const self = roles(req).find((r) => r.key === "self");
  return first === undefined || self === undefined ? null : ageInYear(self.member, first);
}

/**
 * 「○歳時点の金融資産」に使う年齢: 今より前の年齢（保存した表示の設定・別の世帯で選んだ年齢が残っていたとき）は、表の最初の年の年齢にする。
 * 表に無い年を引くと「0万円」になるため（表の最後の年より後の年齢は、今までどおり表の最後の年で引く）
 */
export function atAgeIn(req: EngineRequest, targetAge: number): number {
  const first = firstAgeOf(req);
  return first === null ? targetAge : Math.max(targetAge, first);
}

/** 「○歳時点の金融資産」の年: 本人のその年齢の年（今より前の年齢は表の最初の年、表の最後の年より後は表の最後の年）。本人がいなければ表の最後の年 */
export function targetYearOf(req: EngineRequest, targetAge: number): number {
  const years = displayYears(req);
  const last = years.at(-1) ?? req.input.endYear;
  const self = roles(req).find((r) => r.key === "self");
  return self !== undefined ? Math.min(last, parseYm(self.member.birth.birthYearMonth).y + atAgeIn(req, targetAge)) : last;
}

/** 条件に合うマスを年ごとに合計する */
export function sumByYear(table: readonly TableCell[], pred: (c: TableCell) => boolean): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of table) if (pred(c)) out.set(c.year, (out.get(c.year) ?? 0) + c.amount);
  return out;
}

export const financialOf = (t: readonly TableCell[]) => sumByYear(t, (c) => c.row === "cf.balance.financial");

/**
 * そのプランの表がある年だけに絞った年（帯・重ねるグラフの年は現状の表の年なので、プランで表の最後の年を短くしたときは、
 * その後の年をそのプランの値の無い年として扱う。0 円の年として描かない・数えない）
 */
export function yearsWithin(table: readonly TableCell[], years: readonly number[]): readonly number[] {
  let last = Number.NEGATIVE_INFINITY;
  for (const c of table) if (c.year > last) last = c.year;
  return last === Number.NEGATIVE_INFINITY || last >= (years.at(-1) ?? last) ? years : years.filter((y) => y <= last);
}

const endsOf = <K extends string>(key: K, table: readonly TableCell[], years: readonly number[]): Partial<Record<K, number>> => {
  const own = yearsWithin(table, years);
  return own.length < years.length ? ({ [key]: own.length } as Partial<Record<K, number>>) : {};
};

/** 計算エンジンの資金不足の行（預金と、取り崩しの順で取り崩せる器で払えなかった額。0179） */
export const SHORTFALL_ROW = "cf.balance.shortfall";

/**
 * 資産が尽きる年: 使えるお金で払えなくなる年（計算エンジンの資金不足の行がはじめて出る年）。金融資産の合計がまだ正でも、残りが
 * 引き出せない器（60歳前の iDeCo など）・取り崩さない器だけなら尽きたとみる（バランスシートの「資金の不足」と同じ判断。0179）。
 * 金融資産がマイナスの年も尽きたとみる。尽きなければ null
 */
export function depletionYear(table: readonly TableCell[], years: readonly number[]): number | null {
  const fin = financialOf(table);
  const short = sumByYear(table, (c) => c.row === SHORTFALL_ROW);
  for (const y of years) if ((fin.get(y) ?? 0) < 0 || (short.get(y) ?? 0) > 0) return y;
  return null;
}

/** その年に世帯にいるか（生まれていて、加わる前でなく、独立などで抜けていない。gone: 亡くなった人の鍵と亡くなる年。翌年からいない） */
export function inHousehold(r: Role, y: number, gone?: { key: string; year: number }): boolean {
  if (gone !== undefined && r.key === gone.key && y > gone.year) return false;
  return presentInYear(r, y);
}

/** 年の目盛りの下の年齢の段: 本人と配偶者（単身の世帯は本人だけ）。いない年は null */
export function ageAxis(rs: readonly Role[], years: readonly number[], gone?: { key: string; year: number }): AgeAxisRow[] {
  return rs.filter((r) => r.key === "self" || r.key === "spouse").map((r) => ({ label: r.label, ages: years.map((y) => (inHousehold(r, y, gone) ? ageInYear(r.member, y) : null)) }));
}

/** 結果の画面（表・グラフ）での構成員の呼び方: 世帯の外の家族は「お母さま」「ご本人のお母さま」など（outsideName）、ほかは続柄の呼び方 */
export function personLabel(req: EngineRequest, r: Role): string {
  return r.member.outside !== undefined ? outsideName(req, r.member) : r.label;
}

/**
 * その年の家族全員の年齢の文字（例: 「ご本人64歳・配偶者62歳・第1子35歳」。世帯にいる人だけ）。
 * nameOf は呼び方（結果の画面は personLabel。表の年齢の行と同じ呼び方にする）
 */
export function familyText(rs: readonly Role[], y: number, gone?: { key: string; year: number }, nameOf: (r: Role) => string = (r) => r.label): string {
  return rs
    .filter((r) => inHousehold(r, y, gone))
    .map((r) => nameWithAge(nameOf(r), ageInYear(r.member, y)))
    .join("・");
}

/** 表の行の決め方。key は提示層に渡す鍵（物の ID を含まない） */
export interface RowDef {
  key: string;
  label: string;
  group: "income" | "expense" | "net" | "assets";
  kind: "value" | "total";
  match: (c: TableCell) => boolean;
  /** 根拠を出せる行（お金の動きか年に1回決まる行から来る行） */
  evidence: boolean;
  /** 行の見出しの説明（押さずに見る短い文。無ければ出さない） */
  note?: string;
}

/** 車（何台でも）の支出のマス: 買い替え・維持費（車検・税・保険・駐車場・燃料）・ローンの返済。車の物の ID で見分ける */
export function carExpense(req: EngineRequest): (c: TableCell) => boolean {
  const ids = new Set((req.input.household.cars ?? []).map((c) => c.id));
  return (c) => ids.size > 0 && c.object !== undefined && ids.has(c.object) && under(c.row, "cf.expense");
}

/** 住まい以外の不動産のローン（負債の property）のマス。負債の物の ID で見分ける（0127） */
export function propertyLoanCell(req: EngineRequest): (c: TableCell) => boolean {
  const ids = new Set((req.input.household.debts ?? []).filter((d) => d.property !== undefined).map((d) => d.id));
  return (c) => ids.size > 0 && c.object !== undefined && ids.has(c.object);
}

/** 住まい以外の不動産（中身 property を持つ不動産の器）を売った手取りのマス。物の ID で見分ける（住まいの売却・中身の無い不動産の売却は入らない。0128） */
export function propertySaleCell(req: EngineRequest): (c: TableCell) => boolean {
  const ids = new Set((req.input.household.accounts ?? []).filter((a) => a.kind === "realEstate" && a.property !== undefined).map((a) => a.id));
  return (c) => ids.size > 0 && c.row === "cf.income.lumpSum.realEstateSale" && c.object !== undefined && ids.has(c.object);
}

/**
 * 表の行の定義。names は事務所の名前（カスタム層の名前の差し替えで FP が承認した、表の行の名前。0016 の 2026-11-02 の追記）。
 * 結果の表・お客さまに見せる画面・提案書・持ち帰り用のレポートで同じ名前にする（提案書も report/src/rowNames.ts の同じ当て方）
 */
export function rowDefs(req: EngineRequest, names?: OfficeRowNames): RowDef[] {
  const rs = roles(req);
  const defs: RowDef[] = [];
  const byMember = (prefix: string, role: Role) => (c: TableCell) => under(c.row, prefix) && c.member === role.member.id;
  // 車があるときだけ「車」の行を出し、車の支出はほかの行から外す（台数が増えても1行。提案書の表と同じ）
  const hasCar = (req.input.household.cars ?? []).length > 0;
  // 住まい以外の不動産の家賃収入・経費があるときだけ、その行を出す（ほかの行から外す。0028）
  const props = (req.input.household.accounts ?? []).filter((a) => a.kind === "realEstate" && a.property !== undefined);
  const hasRent = props.some((a) => a.property?.rental !== undefined);
  const hasReExp = props.some((a) => a.property?.rental !== undefined || a.property?.expenses !== undefined || (a.property?.repairs ?? []).length > 0);
  const isRent = (c: TableCell) => hasRent && c.row === "cf.income.other.rental";
  const isReExp = (c: TableCell) => hasReExp && c.row === "cf.expense.other.realEstate";
  // 住まい以外の不動産を売った手取りは「不動産の売却」の行にする（売る予定を入れた物件があるときだけ。住まいの売却は「その他の収入」のまま。0128）
  const isReSale = propertySaleCell(req);
  const hasReSale = props.some((a) => a.property?.sale !== undefined);
  // 住まい以外の不動産のローン（負債の property）は、返済と残高を住まいのローン・その他の支出と分けた行にする（0127）
  const reLoan = propertyLoanCell(req);
  const isReLoanPay = (c: TableCell) => reLoan(c) && under(c.row, "cf.expense");
  const hasReLoan = (req.input.household.debts ?? []).some((d) => d.property !== undefined);
  const car = carExpense(req);
  const notCar = (p: (c: TableCell) => boolean) => (c: TableCell) => p(c) && !car(c);
  // 世帯の外の家族（家計を1つにする期間のうち収入を世帯に入れる月の分だけ入る）は、呼び方と期間を見出しに出して世帯の人の行と分ける（0075）
  const who = (r: Role) => personLabel(req, r);
  const outsideNote = (r: Role) => (r.member.outside !== undefined ? { note: OUTSIDE_INCOME_NOTE } : {});
  const span = (r: Role) => (r.member.outside !== undefined ? "（家計を1つにする間）" : "");
  for (const r of rs) defs.push({ key: `salary:${r.key}`, label: `${rowName(names, "salary", { person: who(r) })}${span(r)}`, group: "income", kind: "value", match: byMember("cf.income.salary", r), evidence: true, ...outsideNote(r) });
  // 事業所得（自営業・フリーランス）は人ごとに給与と並べる（「その他の収入」に入れない。値の無い人は表に出ない）
  for (const r of rs) defs.push({ key: `business:${r.key}`, label: `${rowName(names, "business", { person: who(r) })}${span(r)}`, group: "income", kind: "value", match: byMember("cf.income.business", r), evidence: true, ...outsideNote(r) });
  for (const r of rs) defs.push({ key: `pension:${r.key}`, label: `${rowName(names, "pension", { person: who(r) })}${span(r)}`, group: "income", kind: "value", match: byMember("cf.income.pension", r), evidence: true, ...outsideNote(r) });
  const ids = new Set(rs.map((r) => r.member.id));
  const known = (c: TableCell, p: string) => under(c.row, p) && c.member !== undefined && ids.has(c.member);
  defs.push(
    // 年金で受け取る企業年金・iDeCo・小規模企業共済の分割・個人年金保険など（cf.income.corporatePension の全部。一時金は「退職金」か「その他の収入」）
    { key: "corporatePension", label: "企業年金・個人年金", group: "income", kind: "value", match: (c) => under(c.row, "cf.income.corporatePension"), evidence: true },
    { key: "retirement", label: "退職金", group: "income", kind: "value", match: (c) => under(c.row, "cf.income.lumpSum.retirement"), evidence: true },
    { key: "benefit", label: "給付・手当", group: "income", kind: "value", match: (c) => under(c.row, "cf.income.benefit"), evidence: true },
    ...(hasRent ? [{ key: "rent", label: "家賃収入", group: "income" as const, kind: "value" as const, match: isRent, evidence: true }] : []),
    ...(hasReSale ? [{ key: "realEstateSale", label: "不動産の売却", group: "income" as const, kind: "value" as const, match: isReSale, evidence: true }] : []),
    {
      key: "incomeOther",
      label: "その他の収入",
      group: "income",
      kind: "value",
      match: (c) => under(c.row, "cf.income") && !known(c, "cf.income.salary") && !known(c, "cf.income.business") && !known(c, "cf.income.pension") && !under(c.row, "cf.income.corporatePension") && !under(c.row, "cf.income.lumpSum.retirement") && !under(c.row, "cf.income.benefit") && !isRent(c) && !(hasReSale && isReSale(c)),
      evidence: true,
    },
    { key: "incomeTotal", label: "収入合計", group: "income", kind: "total", match: (c) => under(c.row, "cf.income"), evidence: false },
    { key: "living", label: ROW_NAMES.living as string, group: "expense", kind: "value", match: notCar((c) => under(c.row, "cf.expense.living") && c.row !== SURPLUS_ROW), evidence: true },
    // 黒字のうち貯まらない分（0031。黒字のうち貯まる割合を入れたときだけ、値のある年に出る）
    { key: "surplusSpend", label: "ゆとりの支出", group: "expense", kind: "value", match: (c) => c.row === SURPLUS_ROW, evidence: true },
    { key: "housing", label: "住居費（ローン・税・修繕）", group: "expense", kind: "value", match: (c) => under(c.row, "cf.expense.housing") && !isReLoanPay(c), evidence: true },
    { key: "education", label: "教育費", group: "expense", kind: "value", match: (c) => under(c.row, "cf.expense.education"), evidence: true },
    { key: "insurance", label: "保険料", group: "expense", kind: "value", match: notCar((c) => under(c.row, "cf.expense.insurance")), evidence: true },
    { key: "lumpSum", label: "一時的支出（旅行など）", group: "expense", kind: "value", match: notCar((c) => under(c.row, "cf.expense.lumpSum")), evidence: true },
    ...(hasCar ? [{ key: "car", label: "車の費用", group: "expense" as const, kind: "value" as const, match: car, evidence: true }] : []),
    ...(hasReExp ? [{ key: "realEstateExpense", label: "不動産の経費", group: "expense" as const, kind: "value" as const, match: isReExp, evidence: true }] : []),
    ...(hasReLoan ? [{ key: "realEstateLoan", label: "不動産のローンの返済", group: "expense" as const, kind: "value" as const, match: isReLoanPay, evidence: true }] : []),
    {
      key: "expenseOther",
      label: "その他の支出",
      group: "expense",
      kind: "value",
      match: notCar((c) => under(c.row, "cf.expense") && !["cf.expense.living", "cf.expense.housing", "cf.expense.education", "cf.expense.insurance", "cf.expense.lumpSum"].some((p) => under(c.row, p)) && !isReExp(c) && !isReLoanPay(c)),
      evidence: true,
    },
    { key: "taxSi", label: "税・社会保険料", group: "expense", kind: "value", match: (c) => under(c.row, "cf.taxSi"), evidence: true },
    { key: "expenseTotal", label: "支出合計", group: "expense", kind: "total", match: (c) => under(c.row, "cf.expense") || under(c.row, "cf.taxSi"), evidence: false },
    { key: "net", label: "年間収支", group: "net", kind: "total", match: (c) => c.row === "cf.net", evidence: false },
    { key: "nisaIn", label: "NISAへの積立", group: "assets", kind: "value", match: (c) => under(c.row, "cf.transfer.nisa"), evidence: true },
    { key: "financial", label: "金融資産残高", group: "assets", kind: "total", match: (c) => c.row === "cf.balance.financial", evidence: true },
    { key: "debt", label: "住宅ローン残高", group: "assets", kind: "value", match: (c) => under(c.row, "cf.balance.debt") && !reLoan(c), evidence: true },
    ...(hasReLoan ? [{ key: "realEstateDebt", label: "不動産のローン残高", group: "assets" as const, kind: "value" as const, match: (c: TableCell) => under(c.row, "cf.balance.debt") && reLoan(c), evidence: true }] : []),
  );
  // 事務所の名前（人ごとの行は上で当てた）。公式の名前は report/src/rowNames.ts の表と同じ（テストで確かめる）
  return names === undefined ? defs : defs.map((d) => (d.key.includes(":") ? d : { ...d, label: rowName(names, d.key) }));
}

const STAGE_AGE: Record<string, number> = { elementary: 6, juniorHigh: 12, highSchool: 15, university: 18 };
const STAGE_NAME: Record<string, string> = { elementary: "小学校", juniorHigh: "中学校", highSchool: "高校", university: "大学" };
const SECTOR: Record<string, string> = { public: "公立", private: "私立", national: "国立" };
// 大学の系統の言い方は提案書（report/src/build.ts の FIELD）と同じ
const FIELD: Record<string, string> = { humanities: "文系", science: "理系", medical: "医歯系" };
const LIVING: Record<string, string> = { away: "自宅外", home: "自宅" };

/** 学校に入る年（表示のための目安。4月2日〜翌年4月1日生まれが同じ学年） */
export function schoolEntryYear(birthYearMonth: string, bornOnFirst: boolean, stage: string): number | null {
  const age = STAGE_AGE[stage];
  if (age === undefined) return null;
  const { y, m } = parseYm(birthYearMonth);
  const early = m < 4 || (m === 4 && bornOnFirst);
  return y + age + (early ? 0 : 1);
}

/** 世帯の外の家族のお金が尽きる見込みの月（エンジンの要約 outsideWallets。0042） */
export function walletDepletions(summary: unknown): { member: string; depleted: string }[] {
  const ws = (summary as { outsideWallets?: { member: string; depleted: string | null }[] } | null | undefined)?.outsideWallets ?? [];
  return ws.flatMap((w) => (w.depleted !== null ? [{ member: w.member, depleted: w.depleted }] : []));
}

/**
 * 住まい以外の不動産の出来事（物件を売る・大きな修繕。印は「不」）。object はその物件の物の ID（収益不動産のタブのグラフで物件ごとに分ける。0128）。
 * 売却は売った手取りのマスがある年、大きな修繕は分析の数字でその年に持っていて修繕の額がある物（売った後の修繕は載せない。0127）。年の範囲では絞らない
 */
export function propertyEvents(req: EngineRequest, proposed: readonly TableCell[], summary?: unknown): (EventChip & { object: string })[] {
  const h = req.input.household;
  const self = roles(req).find((r) => r.key === "self");
  const out: (EventChip & { object: string })[] = [];
  const props = (h.accounts ?? []).filter((a) => a.kind === "realEstate" && a.property !== undefined);
  const propName = (a: (typeof props)[number], i: number) => (a.property?.name !== undefined && a.property.name.trim() !== "" ? a.property.name : `物件${i + 1}`);
  const analysis = new Map(((summary as { realEstateAnalysis?: { properties?: { object: string; years: { year: number; repairs: number }[] }[] } } | null | undefined)?.realEstateAnalysis?.properties ?? []).map((p) => [p.object, p]));
  props.forEach((a, i) => {
    const sold = proposed.find((c) => c.row === "cf.income.lumpSum.realEstateSale" && c.object === a.id && c.amount > 0);
    if (sold !== undefined) out.push({ object: a.id, year: sold.year, icon: "不", text: `${propName(a, i)}を売却${self !== undefined ? `（${self.label}${ageInYear(self.member, sold.year)}歳）` : ""}`, short: false });
    const rows = analysis.get(a.id)?.years ?? [];
    for (const r of a.property?.repairs ?? []) {
      const m = resolveTimepoint(h, r.at);
      if (m === null) continue;
      const y = parseYm(m).y;
      if (rows.some((x) => x.year === y && x.repairs > 0)) out.push({ object: a.id, year: y, icon: "不", text: `${propName(a, i)}の大きな修繕${r.label !== undefined && r.label !== "" ? `（${r.label}）` : ""}`, short: false });
    }
  });
  return out;
}

/** 年のライフイベント（案の要求と結果から。学校・独立・退職・年金・ローン完済・世帯の外の家族のお金が尽きる見込み・資産が尽きる年） */
export function eventsOf(req: EngineRequest, proposed: readonly TableCell[], years: readonly number[], summary?: unknown): EventChip[] {
  const rs = roles(req);
  const h = req.input.household;
  const first = years[0] ?? 0;
  const last = years.at(-1) ?? 0;
  const out: EventChip[] = [];
  const add = (year: number, icon: EventIcon, text: string, short = false) => {
    if (year >= first && year <= last) out.push({ year, icon, text, short });
  };
  for (const g of h.goals ?? []) {
    const role = rs.find((r) => r.member.id === g.owner);
    if (g.kind !== "education" || role === undefined) continue;
    for (const s of g.education?.stages ?? []) {
      if (s.stage !== "highSchool" && s.stage !== "university") continue;
      const y = schoolEntryYear(role.member.birth.birthYearMonth, role.member.birth.bornOnFirst, s.stage);
      if (y === null) continue;
      const detail = [s.sector !== undefined ? SECTOR[s.sector] : "", s.field !== undefined ? FIELD[s.field] : ""].join("") + (s.living !== undefined ? `・${LIVING[s.living] ?? ""}` : "");
      add(y, "学", `${role.label} ${STAGE_NAME[s.stage]}入学${detail !== "" ? `（${detail}）` : ""}（${role.label}${ageInYear(role.member, y)}歳）`);
    }
  }
  for (const r of rs) {
    const ly = leaveYear(r);
    if (ly !== null && r.member.kind === "child") add(ly, "独", `${r.label} 独立（${r.label}${ageInYear(r.member, ly)}歳）`);
  }
  const lv = (r: Role) => readLevers(req, r.member.id);
  for (const r of rs.filter((x) => x.key === "self" || x.key === "spouse")) {
    const v = lv(r);
    if (v.retireAge !== undefined) {
      const y = parseYm(ageReachedMonth(r.member, v.retireAge)).y;
      if (y <= req.input.endYear) add(y, "退", `${r.label} 退職（${r.label}${v.retireAge}歳）`);
    }
    if (v.pensionAge !== undefined) {
      const y = parseYm(addMonths(ageReachedMonth(r.member, v.pensionAge), 1)).y;
      add(y, "年", `${r.label} 年金の受け取り開始（${v.pensionAge}歳）`);
    }
  }
  const loan = sumByYear(proposed, (c) => under(c.row, "cf.expense.housing.loan"));
  const paid = [...loan.entries()].filter(([, v]) => v > 0).map(([y]) => y).sort((a, b) => a - b).at(-1);
  const self = rs.find((r) => r.key === "self");
  if (paid !== undefined && paid < req.input.endYear) add(paid, "家", `住宅ローン完済${self !== undefined ? `（${self.label}${ageInYear(self.member, paid)}歳）` : ""}`);
  // 住まい以外の不動産を売る・大きな修繕（0127。提案書のライフイベント表と同じ出来事。収益不動産のタブのグラフも同じ印。0128）
  for (const e of propertyEvents(req, proposed, summary)) add(e.year, e.icon, e.text);
  for (const w of walletDepletions(summary)) {
    const m = h.members.find((x) => x.id === w.member);
    if (m === undefined) continue;
    const { y, m: mo } = parseYm(w.depleted);
    const who = outsideName(req, m);
    add(y, "親", `${who}のお金が尽きる見込み（${y}年${mo}月・${nameWithAge(who, ageInYear(m, y))}。この後の介護の費用は世帯が払います）`);
  }
  const dep = depletionYear(proposed, years);
  if (dep !== null) add(dep, "！", `資産が尽きる${self !== undefined ? `（${self.label}${ageInYear(self.member, dep)}歳）` : ""}`, true);
  return out.sort((a, b) => a.year - b.year || a.icon.localeCompare(b.icon));
}

function verdict(self: Role | undefined, depP: number | null, depC: number | null, endAge: number | null): Verdict {
  const who = self?.label ?? "";
  const age = (y: number) => (self !== undefined ? ageInYear(self.member, y) : y);
  const until = endAge !== null ? `${endAge}歳まで` : "最後まで";
  if (depP === null && depC !== null)
    return { tone: "up", parts: [{ text: "↑ 資産が " }, { text: `${until}尽きなく`, strong: true }, { text: `なりました（現状は${who} ${age(depC)}歳で不足）` }] };
  if (depP === null && depC === null) return { tone: "flat", parts: [{ text: "現状も提案も、" }, { text: `${until}資産が尽きません`, strong: true }] };
  if (depP !== null && depC === null) return { tone: "down", parts: [{ text: "↓ 提案では " }, { text: `${who}${age(depP)}歳で資産が不足`, strong: true }, { text: "します（現状は不足しません）" }] };
  const p = depP as number;
  const c = depC as number;
  if (p === c) return { tone: "flat", parts: [{ text: "資産が尽きる時期は変わりません（" }, { text: `${who}${age(p)}歳`, strong: true }, { text: "）" }] };
  const later = p > c;
  return {
    tone: later ? "up" : "down",
    parts: [{ text: `${later ? "↑" : "↓"} 資産が尽きる年が ` }, { text: `${Math.abs(p - c)}年${later ? "遅く" : "早く"}`, strong: true }, { text: `なりました（${who}${age(c)}歳→${age(p)}歳）` }],
  };
}

/**
 * 主画面の結論の1文: 「B案は100歳まで足ります」＋2行目「A案（基準）は80歳で資産が尽きます」。
 * 選んだ案が基準の案のときは「A案（基準）：80歳で資産が尽きます」の1行。○歳時点の資産は既定では出さない（表示の設定で足す）
 */
export function resultVerdict(names: SeriesNames, self: Role | undefined, depP: number | null, depC: number | null, endAge: number | null, w: Wording = OFFICIAL_WORDING): ResultVerdict {
  // 文は結果の画面の文の表（resultTexts.ts の result:main/…）から。事務所の文を承認していれば、その文に同じ値を差し込む（0212）
  const age = (y: number) => (self !== undefined ? ageInYear(self.member, y) : y);
  const until = endAge !== null ? w.text("result:main/lasts", { age: `${endAge}歳` }) : w.text("result:main/lastsToEnd");
  const st = (d: number | null) => (d === null ? until : w.text("result:main/runsOut", { age: `${age(d)}歳` }));
  if (names.same) return { tone: depP === null ? "up" : "down", parts: w.parts("result:main/verdictSame", { plan: names.selected, status: st(depP) }), sub: [] };
  const better = depP === depC ? "flat" : depP === null ? "up" : depC === null ? "down" : depP > depC ? "up" : "down";
  return { tone: better, parts: w.parts("result:main/verdict", { plan: names.selected, status: st(depP) }), sub: w.parts("result:main/verdictBase", { basePlan: names.base, baseStatus: st(depC) }) };
}

/** FP顧問料の ON/OFF の材料（顧問料の契約があるときだけ） */
export interface FeeInput {
  on: boolean;
  /** ON と OFF を入れ替えた案の結果（差を一文に出すため。まだ無ければ null） */
  alt: PreviewResult | null;
}

/** FP顧問料の一文: 「FP顧問料を払っても、ご本人95歳時点の資産は現状より○万円多い」。顧問料の累計の額は出さない（額は入力・提案書の顧問料の欄で見る） */
export function feeLine(input: { fee: FeeInput; targetYear: number; targetLabel: string; finP: Map<number, number>; finC: Map<number, number>; baseLabel?: string }): FeeLine {
  const { fee, targetYear, targetLabel, finP, finC } = input;
  const than = input.baseLabel ?? "現状";
  const diffOf = (fin: Map<number, number>) => (fin.get(targetYear) ?? 0) - (finC.get(targetYear) ?? 0);
  const word = (d: number) => `${man(Math.abs(d))}万円${d >= 0 ? "多い" : "少ない"}`;
  const alt = fee.alt === null ? null : diffOf(financialOf(fee.alt.table));
  const d = diffOf(finP);
  if (fee.on) {
    const parts: VerdictPart[] = [
      { text: `FP顧問料を${d >= 0 ? "払っても" : "含めると"}、${targetLabel}時点の資産は${than}より ` },
      { text: word(d), strong: true },
    ];
    if (alt !== null) parts.push({ text: `（顧問料を除くと${word(alt)}）` });
    return { on: true, parts };
  }
  const parts: VerdictPart[] = [{ text: "FP顧問料を含めない試算です。" }];
  if (alt !== null) parts.push({ text: `含めると、${targetLabel}時点の資産は${than}より ` }, { text: word(alt), strong: true });
  return { on: false, parts };
}

export interface PresentInput {
  /** 現状の要求 */
  base: EngineRequest;
  /** 提案の要求（打ち手を当てたもの） */
  proposal: EngineRequest;
  current: PreviewResult;
  proposed: PreviewResult;
  targetAge: number;
  selectedYear: number | null;
  provisional: boolean;
  /** FP顧問料の ON/OFF（契約が無ければ省略） */
  fee?: FeeInput;
  /** 線の呼び方（主画面: 選んだ案「B案」・基準の案「A案」）。省略は「提案」と「現状」 */
  names?: SeriesNames;
  /** 基準の案の要求（基準の案の年のイベントに使う）。省略は base */
  baseProposal?: EngineRequest;
  /** 表の行の事務所の名前（カスタム層の名前の差し替え。省略は公式の名前） */
  rowNames?: OfficeRowNames;
  /** 結果の画面の文（承認した事務所の文を当てた物。省略は公式の文。0212） */
  wording?: Wording;
  /**
   * 選んだプランか基準のプランが今の入力で計算できなかった（計算エンジンのエラー。結果は前の計算の残り）。結論の1文に「足りる」を出さない（0169。
   * 区画「夢と予定」の数字と一行の結論は workspace/bigMoney.ts の bigMoneyOf で出さない）
   */
  failed?: boolean;
}

export function toPresentation(input: PresentInput): PresentationModel {
  const { base, proposal, current, proposed } = input;
  const names: SeriesNames = input.names ?? { selected: "提案", base: "現状", same: false };
  const custom = input.names !== undefined;
  const years = displayYears(base);
  const rs = roles(base);
  const self = rs.find((r) => r.key === "self");
  const finP = financialOf(proposed.table);
  const finC = financialOf(current.table);
  const depP = depletionYear(proposed.table, years);
  const depC = depletionYear(current.table, years);
  const lastYear = years.at(-1) ?? base.input.endYear;
  const endAge = self !== undefined ? ageInYear(self.member, lastYear) : null;

  const targetYear = targetYearOf(base, input.targetAge);
  const age = (y: number) => (self !== undefined ? ageInYear(self.member, y) : null);
  const headline: Headline = {
    label: `${self !== undefined ? `${self.label}${age(targetYear)}歳` : `${targetYear}年`}時点の金融資産（${names.selected}）`,
    amount: finP.get(targetYear) ?? 0,
    currentAmount: finC.get(targetYear) ?? 0,
    diff: (finP.get(targetYear) ?? 0) - (finC.get(targetYear) ?? 0),
    currentNote: depC !== null ? `${self?.label ?? ""}${age(depC) ?? depC}歳で不足` : null,
  };

  const depletions: Depletion[] = [];
  if (depC !== null) depletions.push({ series: "current", year: depC });
  if (depP !== null) depletions.push({ series: "proposal", year: depP });
  const chart: ChartModel = {
    years,
    ages: years.map((y) => age(y)),
    axis: ageAxis(rs, years),
    family: years.map((y) => familyText(rs, y, undefined, (r) => personLabel(base, r))),
    proposal: years.map((y) => finP.get(y) ?? 0),
    current: years.map((y) => finC.get(y) ?? 0),
    depletions,
    // プランで表の最後の年を短くしたプランは、その後の年を値の無い年にする（線と塗りをそこで終える）
    ...endsOf("proposalEnds", proposed.table, years),
    ...endsOf("currentEnds", current.table, years),
  };

  const selectedYear = input.selectedYear !== null && years.includes(input.selectedYear) ? input.selectedYear : (years[Math.min(4, years.length - 1)] ?? lastYear);
  const present = (r: Role, y: number) => inHousehold(r, y);
  const sumYear = (pred: (c: TableCell) => boolean, y: number) => proposed.table.reduce((s, c) => (c.year === y && pred(c) ? s + c.amount : s), 0);
  const yearDetail: YearDetail = {
    year: selectedYear,
    members: familyText(rs, selectedYear, undefined, (r) => personLabel(base, r)),
    income: sumYear((c) => under(c.row, "cf.income"), selectedYear),
    expense: sumYear((c) => under(c.row, "cf.expense") || under(c.row, "cf.taxSi"), selectedYear),
    net: sumYear((c) => c.row === "cf.net", selectedYear),
    financial: finP.get(selectedYear) ?? 0,
  };

  const evs = eventsOf(proposal, proposed.table, years, proposed.summary);
  const table = cashflowTable(proposal, proposed.table, years, custom ? "生涯キャッシュフロー表" : "生涯キャッシュフロー表（提案）", evs, input.rowNames);
  const baseFlows = flowChart(input.baseProposal ?? base, current.table, years, custom ? `収支の推移（${names.base}）` : "収支の推移（現状）");


  const { y: by, m: bm } = parseYm(base.input.baseMonth);
  return {
    // 世帯の外の家族（介護・親で足した親・祖父母など）は、世帯の人の並びに出さない（「ご家族 92歳」が並ぶため。表の年齢の行には「お母さま」などで出る）
    members: rs.filter((r) => r.member.outside === undefined && present(r, by)).map((r) => ({ label: r.label, age: ageInYear(r.member, by) })),
    asOf: `${by}年${bm}月時点`,
    headline,
    verdict: input.failed === true ? { tone: "flat", parts: [{ text: "今の入力では計算できませんでした", strong: true }] } : verdict(self, depP, depC, endAge),
    result: input.failed === true ? { tone: "flat", parts: [{ text: "今の入力では計算できませんでした", strong: true }], sub: [] } : resultVerdict(names, self, depP, depC, endAge, input.wording),
    names,
    chart,
    flows: flowChart(proposal, proposed.table, years, "収支の推移（提案）"),
    baseLines: { net: baseFlows.net },
    baseCharts: { flows: baseFlows, events: eventsOf(input.baseProposal ?? base, current.table, years, current.summary) },
    who: self?.label ?? "",
    selectedYear,
    yearDetail,
    events: evs,
    table,
    // 子が返す貸与の奨学金（世帯の収支に入れていない返済の額を書き添える。0104）
    childRepaid: childScholarshipNotes(proposed.summary, (id) => roles(proposal).find((r) => r.member.id === id)?.label ?? "子"),
    fee: input.fee === undefined ? null : feeLine({ fee: input.fee, targetYear, targetLabel: self !== undefined ? `${self.label}${age(targetYear)}歳` : `${targetYear}年`, finP, finC, ...(custom ? { baseLabel: `${names.base}（基準）` } : {}) }),
    provisional: input.provisional,
  };
}

// ---- キャッシュフロー表（案ごと・2つの案の差）----

/** 年齢の行（世帯にいる年だけ。家族全員）。AI接続口の calculate の年ごとの年齢も同じ関数（0194） */
export function ageRows(req: EngineRequest, years: readonly number[]): TableRowModel[] {
  return roles(req).map((r) => ({ kind: "age", key: `age:${r.key}`, label: personLabel(req, r), ages: years.map((y) => (inHousehold(r, y) ? ageInYear(r.member, y) : null)) }));
}

/** 生涯キャッシュフロー表の提示用の値（1つの案）。evs を渡すとライフイベントの行も出す */
export function cashflowTable(req: EngineRequest, table: readonly TableCell[], years: number[], title: string, evs?: EventChip[], names?: OfficeRowNames): CashflowTableModel {
  const rows: TableRowModel[] = ageRows(req, years);
  if (evs !== undefined) rows.push({ kind: "events", key: "events", label: "ライフイベント", events: years.map((y) => evs.filter((e) => e.year === y)) });
  const groupLabel: Record<RowDef["group"], string> = { income: "収入", expense: "支出", net: "", assets: "貯蓄・資産" };
  let lastGroup: RowDef["group"] | null = null;
  for (const d of rowDefs(req, names)) {
    const sums = sumByYear(table, d.match);
    const cells = years.map((y) => {
      const v = sums.get(y);
      return { amount: v === undefined ? null : v, ...(d.key === "financial" && (v ?? 0) < 0 ? { short: true } : {}) };
    });
    if (d.kind === "value" && cells.every((c) => (c.amount ?? 0) === 0)) continue;
    if (d.group !== lastGroup && groupLabel[d.group] !== "") rows.push({ kind: "group", key: `group:${d.group}`, label: groupLabel[d.group] });
    lastGroup = d.group;
    // 年間収支の行は、開くと赤字の出どころ（口座から取り崩して払った分・家計の赤字）を出す（0075）
    const children = d.key === "net" ? deficitSources(req, table, years) : null;
    rows.push({ kind: d.kind, key: d.key, label: d.label, cells, evidence: d.evidence, ...(children !== null ? { children, note: DEFICIT_NOTE } : d.note !== undefined ? { note: d.note } : {}) });
  }
  return { title, years, rows };
}

/**
 * 2つの案の差のキャッシュフロー表（b − a。年ごと・行ごと）。根拠は出さない（差は計算式ではないため）。
 * 行の決め方は両方の案の構成員から（a の要求の行の定義を使う。構成員は案で変わらない）
 */
export function diffCashflowTable(req: EngineRequest, a: readonly TableCell[], b: readonly TableCell[], years: number[], title: string, names?: OfficeRowNames): CashflowTableModel {
  const rows: TableRowModel[] = ageRows(req, years);
  const groupLabel: Record<RowDef["group"], string> = { income: "収入", expense: "支出", net: "", assets: "貯蓄・資産" };
  let lastGroup: RowDef["group"] | null = null;
  for (const d of rowDefs(req, names)) {
    const sa = sumByYear(a, d.match);
    const sb = sumByYear(b, d.match);
    const cells = years.map((y) => {
      const va = sa.get(y);
      const vb = sb.get(y);
      return { amount: va === undefined && vb === undefined ? null : (vb ?? 0) - (va ?? 0) };
    });
    if (cells.every((c) => (c.amount ?? 0) === 0)) continue;
    if (d.group !== lastGroup && groupLabel[d.group] !== "") rows.push({ kind: "group", key: `group:${d.group}`, label: groupLabel[d.group] });
    lastGroup = d.group;
    rows.push({ kind: d.kind, key: d.key, label: d.label, cells, evidence: false });
  }
  return { title, years, rows };
}

/**
 * 表に基準との差を足す: 年間収支と金融資産残高の下に「差（C−A）」の行（見ている案−基準）、基準と違うマスに印。
 * table は見ている案の表（cashflowTable の結果）、shown・base はその案と基準の案の計算結果
 */
export function withDiff(req: EngineRequest, table: CashflowTableModel, shown: readonly TableCell[], base: readonly TableCell[], label: string): CashflowTableModel {
  const defs = new Map(rowDefs(req).map((d) => [d.key, d]));
  const rows: TableRowModel[] = [];
  for (const r of table.rows) {
    if (r.kind !== "value" && r.kind !== "total") {
      rows.push(r);
      continue;
    }
    const d = defs.get(r.key);
    if (d === undefined) {
      rows.push(r);
      continue;
    }
    const sb = sumByYear(base, d.match);
    const ss = sumByYear(shown, d.match);
    rows.push({ ...r, cells: r.cells.map((c, i) => ({ ...c, changed: (ss.get(table.years[i] as number) ?? 0) !== (sb.get(table.years[i] as number) ?? 0) })) });
    if (r.key === "net" || r.key === "financial") rows.push({ kind: "diff", key: `diff:${r.key}`, label, cells: table.years.map((y) => (ss.get(y) ?? 0) - (sb.get(y) ?? 0)) });
  }
  return { ...table, rows };
}

// ---- 収支の推移（資産と負債の推移は balanceTab.ts）----

const series = (key: string, label: string, table: readonly TableCell[], years: readonly number[], pred: (c: TableCell) => boolean): StackSeries => {
  const m = sumByYear(table, pred);
  return { key, label, values: years.map((y) => m.get(y) ?? 0) };
};

/**
 * 収支の推移: 収入（給与・年金・その他）と支出（生活費・住宅・教育・保険・その他）の積み上げ。
 * 住まい以外の不動産を持つ世帯は、収入に「不動産」（家賃収入と、その物件を売った手取り）、支出に「不動産」（経費・大きな修繕・その物件のローンの返済）を足す（0127）
 */
export function flowChart(req: EngineRequest, table: readonly TableCell[], years: number[], title: string): FlowChartModel {
  const self = roles(req).find((r) => r.key === "self");
  const isWork = (c: TableCell) => under(c.row, "cf.income.salary") || under(c.row, "cf.income.business");
  const known = ["cf.expense.living", "cf.expense.housing", "cf.expense.education", "cf.expense.insurance"];
  const net = sumByYear(table, (c) => c.row === "cf.net");
  const props = new Set((req.input.household.accounts ?? []).filter((a) => a.kind === "realEstate" && a.property !== undefined).map((a) => a.id));
  const reLoan = propertyLoanCell(req);
  const ofProp = (c: TableCell) => c.object !== undefined && props.has(c.object);
  const isReSale = propertySaleCell(req);
  const isReIn = (c: TableCell) => (ofProp(c) && c.row === "cf.income.other.rental") || isReSale(c);
  const isReOut = (c: TableCell) => under(c.row, "cf.expense") && (c.row === "cf.expense.other.realEstate" || reLoan(c));
  const withRe = props.size > 0;
  return {
    title,
    years,
    ages: years.map((y) => (self !== undefined ? ageInYear(self.member, y) : null)),
    income: [
      // 事業所得のある世帯は、系列の名前を提案書の「家計の今」と同じ「給与・事業の収入」にする（表は人ごとの「○○の事業所得」の行）
      series("salary", table.some((c) => under(c.row, "cf.income.business") && c.amount !== 0) ? "給与・事業の収入" : "給与", table, years, isWork),
      series("pension", "年金", table, years, (c) => under(c.row, "cf.income.pension")),
      ...(withRe ? [series("realEstateIn", "不動産（家賃・売却）", table, years, isReIn)] : []),
      series("incomeOther", "その他の収入", table, years, (c) => under(c.row, "cf.income") && !isWork(c) && !under(c.row, "cf.income.pension") && !isReIn(c)),
    ],
    expense: [
      series("living", "生活費", table, years, (c) => under(c.row, "cf.expense.living")),
      series("housing", "住宅", table, years, (c) => under(c.row, "cf.expense.housing") && !isReOut(c)),
      series("education", "教育", table, years, (c) => under(c.row, "cf.expense.education")),
      series("insurance", "保険", table, years, (c) => under(c.row, "cf.expense.insurance")),
      ...(withRe ? [series("realEstateOut", "不動産（経費・ローン）", table, years, isReOut)] : []),
      series("expenseOther", "その他（税・社会保険料など）", table, years, (c) => (under(c.row, "cf.expense") && !known.some((p) => under(c.row, p)) && !isReOut(c)) || under(c.row, "cf.taxSi")),
    ],
    net: years.map((y) => net.get(y) ?? 0),
  };
}
