// お金の行（0044）の欄: 出るお金の行（周期的な支出 periodicExpenses）と入るお金の行（incomeFlows）を、どのカードでも同じ形で入れる。
// - 1行のまとまり（簡易）: 名前・種類（そのカードで選べる種類が2つ以上のとき）・時期（1回／毎月／年ごと）・額・始まり・何年ごと・終わり・
//   札（入るお金は見込み、出るお金は優先度。相続・贈与の区画は相手も簡易）
// - 詳細は3つのまとまり: 課税の扱い（入るお金）・あげる贈与（出るお金）／受け取る人・払う人・相手・伸び方・万一のときの扱い・表の行（と、受け取る
//   相続・贈与の「基本の計算に入れる」）／段階と例外の年（staged.ts）
// - 行の属するカードは種類で決まる（INCOME_KINDS・OUT_KINDS の card）。種類の無い出るお金（古い世帯の周期的な支出）はライフイベントの行
//   （黙って書き換えない）。介護・親と相続・贈与のカードはまだ無いので、ライフイベントのカードの区画に置く（カードを組み直す回に移す）
// - 欄はどれも当て先（0036 の2。向き先は行そのもの）を持ち、プランの編集（0043）・値の状態の操作（0041）にそのまま乗る
import { officeNow } from "../office/current.ts";
import type { Debt, Household, IncomeFlow, IncomeFlowKind, IncomeTaxTreatment, Member, MoneyOutKind, PeriodicExpense, Timepoint } from "../../engine/types.ts";
import { excludedDebt, excludedIncome } from "../../engine/moneyRows.ts";
import { ROW_LABELS } from "../../generated/labels.ts";
import { addMonths, ageAt } from "../levers.ts";
import type { Address } from "../store/readings.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { byId, field, getPath, plain, removeAction, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type Level, type Option, type SectionDef } from "./form.ts";
import { mutate, newId, presetBasis, standardBox, type WorkingHousehold } from "./household.ts";
import { GROWTH_KINDS, memberLabel } from "./labels.ts";
import { onContingencyDetailFields, onContingencyFields } from "./stages/onContingency.ts";
import { stagedBadge, stagedGroups } from "./staged.ts";
import { wareki } from "./units.ts";
import { readYearMonth } from "./when.ts";
import { GROWTH_RANGE } from "./rateRanges.ts";
import { toDream } from "./dreams.ts";
import { presetNum, presetRate, presetText } from "../../../../hearing/src/presets.ts";

type Obj = Record<string, unknown>;

/** お金の行を置くカード（介護・親 care と相続・贈与 inherit は、カードを組み直すまでライフイベントの区画） */
export type MoneyCard = "family" | "work" | "pension" | "living" | "education" | "housing" | "insurance" | "rental" | "events" | "car" | "care" | "inherit";

/** 入るお金の種類: 名前・課税の扱いの既定・1回の行とくり返す行の表の行の既定（エンジンの engine/src/sdk/incomeKinds.ts と同じ。テストで突き合わせる）・置くカード・既定の時期 */
export const INCOME_KINDS: readonly { kind: IncomeFlowKind; label: string; help?: string; tax: IncomeTaxTreatment; once: string; repeat: string; card: MoneyCard; cadence: Cadence }[] = [
  { kind: "inheritance", label: "相続・遺贈", tax: "inheritance", once: "cf.income.lumpSum.inheritance", repeat: "cf.income.lumpSum.inheritance", card: "inherit", cadence: "once" },
  { kind: "giftReceived", label: "贈与を受ける", tax: "gift", once: "cf.income.lumpSum.gift", repeat: "cf.income.lumpSum.gift", card: "inherit", cadence: "once" },
  { kind: "support", label: "援助・仕送りを受ける", help: "親などから受け取る援助・仕送りです", tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.other", card: "care", cadence: "monthly" },
  { kind: "educationSupport", label: "教育資金の援助を受ける", help: "祖父母などから受け取る教育資金です", tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.other", card: "education", cadence: "repeat" },
  { kind: "childSupport", label: "養育費を受け取る", tax: "nonTaxable", once: "cf.income.other", repeat: "cf.income.other", card: "family", cadence: "monthly" },
  { kind: "propertyDivision", label: "財産分与", tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.other", card: "family", cadence: "once" },
  { kind: "householdContribution", label: "同居の家族が家計に入れるお金", tax: "nonTaxable", once: "cf.income.other", repeat: "cf.income.other", card: "family", cadence: "monthly" },
  { kind: "benefit", label: "手当・給付金", help: "額を入れて足す手当・給付金です（児童手当は家族から計算します）", tax: "nonTaxable", once: "cf.income.benefit", repeat: "cf.income.benefit", card: "family", cadence: "monthly" },
  { kind: "unemployment", label: "教育訓練給付など", help: "教育訓練給付などの額を入れます。失業給付（基本手当）は、働き方の期間の辞め方から計算します", tax: "nonTaxable", once: "cf.income.benefit.unemployment", repeat: "cf.income.benefit.unemployment", card: "work", cadence: "monthly" },
  { kind: "survivorPension", label: "受給中の遺族年金・障害年金", help: "受け取っている額を入れます", tax: "nonTaxable", once: "cf.income.pension", repeat: "cf.income.pension", card: "pension", cadence: "repeat" },
  { kind: "foreignPension", label: "外国の年金", help: "円の額で入れます", tax: "miscOther", once: "cf.income.pension", repeat: "cf.income.pension", card: "pension", cadence: "repeat" },
  { kind: "scholarshipGrant", label: "給付型の奨学金・学費の助成", help: "額を入れます", tax: "nonTaxable", once: "cf.income.benefit.education", repeat: "cf.income.benefit.education", card: "education", cadence: "repeat" },
  { kind: "childPays", label: "子が払う分", help: "子のアルバイト・子の貯金から学費に充てる分です", tax: "nonTaxable", once: "cf.income.other", repeat: "cf.income.other", card: "education", cadence: "repeat" },
  { kind: "sideJob", label: "副業・雑所得", help: "副業の収入です。所得の区分（雑所得・事業所得）を選べます", tax: "miscBusiness", once: "cf.income.other.sideJob", repeat: "cf.income.other.sideJob", card: "work", cadence: "repeat" },
  { kind: "otherWork", label: "その他の働く収入", help: "給与として本業と合わせて税を計算し、社会保険料はかけません", tax: "salary", once: "cf.income.salary", repeat: "cf.income.salary", card: "work", cadence: "repeat" },
  { kind: "saleBusiness", label: "売却代金（事業・出資持分）", tax: "capitalGains", once: "cf.income.lumpSum.other", repeat: "cf.income.lumpSum.other", card: "work", cadence: "once" },
  { kind: "saleGoods", label: "動産の売却（車以外）", help: "実家じまい・遺品整理での家財や骨董品、住み替えでの家具、貴金属・時計・ブランド品・美術品・コレクション・楽器、バイクなど車以外の乗り物の売却です。1個30万円を超える貴金属・美術品などは税がかかることがあります（課税の扱いを選び直してください）", tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.lumpSum.other", card: "events", cadence: "once" },
  { kind: "temporary", label: "一時所得", help: "懸賞の賞金・競馬の払戻し・法人からもらうお金など。生命保険の満期・解約は保険の項目で計算します", tax: "temporary", once: "cf.income.lumpSum.other", repeat: "cf.income.other", card: "events", cadence: "once" },
  { kind: "celebration", label: "祝い金・お見舞い・一時の給付金", tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.lumpSum.other", card: "events", cadence: "once" },
  { kind: "subsidy", label: "住まいの補助金・移住の支援金", tax: "temporary", once: "cf.income.lumpSum.other", repeat: "cf.income.other", card: "housing", cadence: "once" },
  { kind: "powerSale", label: "売電の収入", tax: "miscOther", once: "cf.income.other", repeat: "cf.income.other", card: "housing", cadence: "repeat" },
  { kind: "insuranceBenefit", label: "計算の型に無い保険の給付の見込み", tax: "nonTaxable", once: "cf.income.other.insuranceBenefit", repeat: "cf.income.other.insuranceBenefit", card: "insurance", cadence: "once" },
  { kind: "other", label: "その他の入金", tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.other", card: "events", cadence: "once" },
];

/** 出るお金の種類: 名前・表の行の既定・置くカード・足すときのひな形（額・時期。推定） */
/** 万円の文字（「50万円」） */
const manText = (v: number | string) => `${(Number(v) / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 4 })}万円`;
/** 種類のひな形の額と根拠の文（presets.ts の目安。事務所の推定の値があればその値。読むたびに引く） */
const presetAmount = (id: string, text: (v: number | string) => string) => ({
  get amount(): number {
    return presetNum(id);
  },
  get preset(): string {
    return presetText(id, text);
  },
});

export const OUT_KINDS: readonly { kind: MoneyOutKind; label: string; help?: string; row: string; card: MoneyCard; cadence: Cadence; amount: number; everyYears?: number; preset: string }[] = [
  { kind: "general", label: "ライフイベントの支出", row: "cf.expense.lumpSum.other", card: "events", cadence: "once", ...presetAmount("preset.events.general", (v) => `一時的支出 ${manText(v)}`) },
  { kind: "childSupport", label: "養育費を払う", row: "cf.expense.other", card: "family", cadence: "monthly", ...presetAmount("preset.events.childSupport", (v) => `養育費 月${manText(v)}`) },
  { kind: "allowance", label: "仕送り", row: "cf.expense.other", card: "care", cadence: "monthly", ...presetAmount("preset.care.allowance", (v) => `仕送り 月${manText(v)}`) },
  // 贈与の110万円は贈与税の基礎控除（法令の値）なので目安の一覧に入れない
  { kind: "gift", label: "あげる贈与", help: "孫などへの贈与です", row: "cf.expense.lumpSum.gift", card: "inherit", cadence: "once", amount: 1100000, preset: "贈与 110万円" },
  { kind: "education", label: "留学・寮費・部活などの教育費", row: "cf.expense.education", card: "education", cadence: "repeat", everyYears: 1, ...presetAmount("preset.education.otherRow", (v) => `その他の教育費 年${manText(v)}`) },
  {
    kind: "repair",
    label: "修繕・リフォーム",
    row: "cf.expense.housing.maintenance",
    card: "housing",
    cadence: "repeat",
    get everyYears(): number {
      return presetNum("preset.housing.repair.everyYears");
    },
    ...presetAmount("preset.housing.repair.amount", (v) => `修繕 ${String(presetNum("preset.housing.repair.everyYears"))}年ごとに${manText(v)}`),
  },
  { kind: "realEstateCost", label: "不動産の一時の経費", help: "大規模修繕・原状回復などの一時の経費です", row: "cf.expense.other", card: "rental", cadence: "once", ...presetAmount("preset.events.realEstateCost", (v) => `不動産の一時の経費 ${manText(v)}`) },
  { kind: "livingAnnual", label: "年1回・数年に1回の支出", row: "cf.expense.living", card: "living", cadence: "repeat", everyYears: 1, ...presetAmount("preset.living.annualRow", (v) => `年払いの支出 年${manText(v)}`) },
  { kind: "car", label: "車の修理・用品など", row: "cf.expense.living.car", card: "car", cadence: "repeat", everyYears: 1, ...presetAmount("preset.car.supplies", (v) => `車の用品など 年${manText(v)}`) },
  { kind: "other", label: "その他の支出", row: "cf.expense.other", card: "events", cadence: "once", ...presetAmount("preset.events.other", (v) => `その他の支出 ${manText(v)}`) },
  // 夢プラン（0103）: ライフイベントの入力項目の「夢プラン」の区画だけで足す（種類の選択には出さない）。額は未入力から
  { kind: "dream", label: "夢", row: "cf.expense.lumpSum.other", card: "events", cadence: "once", amount: 0, preset: "夢 額は未入力" },
];

/** 出るお金の行が選べる表の行（今の8種＋教育費・車の維持費。0044） */
export const OUT_ROWS: Option[] = [
  { value: "cf.expense.lumpSum.other", label: "一時的支出" },
  { value: "cf.expense.lumpSum.wedding", label: "結婚の費用" },
  { value: "cf.expense.lumpSum.gift", label: "贈り物・援助" },
  { value: "cf.expense.lumpSum.car", label: "車両費（一時）" },
  { value: "cf.expense.housing.maintenance", label: "住まいの修繕" },
  { value: "cf.expense.care.medical", label: "医療・介護" },
  { value: "cf.expense.living", label: "基本生活費に含める" },
  { value: "cf.expense.other", label: "その他の支出" },
  { value: "cf.expense.education", label: "教育費" },
  { value: "cf.expense.living.car", label: "車の維持費" },
];



/** 入るお金の行が選べる表の行の全部（エンジンの incomeFlow.row。「その他の入金」はどれも選べる） */
export const IN_ROWS: Option[] = [
  "cf.income.lumpSum.other",
  "cf.income.lumpSum.gift",
  "cf.income.lumpSum.inheritance",
  "cf.income.other",
  "cf.income.other.sideJob",
  "cf.income.other.miscellaneous",
  "cf.income.other.insuranceBenefit",
  "cf.income.salary",
  "cf.income.business",
  "cf.income.pension",
  "cf.income.benefit",
  "cf.income.benefit.unemployment",
  "cf.income.benefit.education",
].map((value) => ({ value, label: ROW_LABELS[value] ?? value }));

/**
 * 種類ごとに選べる表の行（0044 の追記 2026-10-29）。種類の既定の行（1回・くり返し）を必ず含み、その種類のお金として意味のある行だけにする。
 * 書いていない種類（その他の入金）は全部（IN_ROWS）。並びの先頭が既定（画面では全部の一覧の順に並べる）
 */
export const IN_ROWS_BY_KIND: Readonly<Partial<Record<IncomeFlowKind, readonly string[]>>> = {
  inheritance: ["cf.income.lumpSum.inheritance", "cf.income.lumpSum.other"],
  giftReceived: ["cf.income.lumpSum.gift", "cf.income.lumpSum.other", "cf.income.other"],
  support: ["cf.income.other", "cf.income.lumpSum.other", "cf.income.lumpSum.gift"],
  educationSupport: ["cf.income.other", "cf.income.lumpSum.other", "cf.income.lumpSum.gift"],
  childSupport: ["cf.income.other", "cf.income.lumpSum.other"],
  propertyDivision: ["cf.income.lumpSum.other", "cf.income.other"],
  householdContribution: ["cf.income.other", "cf.income.lumpSum.other"],
  benefit: ["cf.income.benefit", "cf.income.lumpSum.other", "cf.income.other"],
  unemployment: ["cf.income.benefit.unemployment", "cf.income.benefit"],
  survivorPension: ["cf.income.pension", "cf.income.other"],
  foreignPension: ["cf.income.pension", "cf.income.other.miscellaneous", "cf.income.other"],
  scholarshipGrant: ["cf.income.benefit.education", "cf.income.benefit", "cf.income.other"],
  childPays: ["cf.income.other", "cf.income.lumpSum.other"],
  sideJob: ["cf.income.other.sideJob", "cf.income.other.miscellaneous", "cf.income.business", "cf.income.other"],
  otherWork: ["cf.income.salary", "cf.income.other.sideJob", "cf.income.other"],
  saleBusiness: ["cf.income.lumpSum.other", "cf.income.other"],
  saleGoods: ["cf.income.lumpSum.other", "cf.income.other"],
  temporary: ["cf.income.lumpSum.other", "cf.income.other"],
  celebration: ["cf.income.lumpSum.other", "cf.income.other", "cf.income.lumpSum.gift"],
  subsidy: ["cf.income.lumpSum.other", "cf.income.other", "cf.income.benefit"],
  powerSale: ["cf.income.other", "cf.income.other.miscellaneous", "cf.income.lumpSum.other"],
  insuranceBenefit: ["cf.income.other.insuranceBenefit", "cf.income.lumpSum.other", "cf.income.other"],
};

/** 出るお金の種類ごとに選べる表の行（種類の無い古い行・一時的支出・その他の支出は全部〔OUT_ROWS〕。先頭が既定（画面では全部の一覧の順に並べる）） */
export const OUT_ROWS_BY_KIND: Readonly<Partial<Record<MoneyOutKind, readonly string[]>>> = {
  childSupport: ["cf.expense.other", "cf.expense.lumpSum.other"],
  allowance: ["cf.expense.other", "cf.expense.living", "cf.expense.lumpSum.gift"],
  gift: ["cf.expense.lumpSum.gift", "cf.expense.lumpSum.other", "cf.expense.other"],
  education: ["cf.expense.education", "cf.expense.lumpSum.other", "cf.expense.other"],
  repair: ["cf.expense.housing.maintenance", "cf.expense.lumpSum.other", "cf.expense.other"],
  realEstateCost: ["cf.expense.other", "cf.expense.lumpSum.other"],
  livingAnnual: ["cf.expense.living", "cf.expense.care.medical", "cf.expense.other"],
  car: ["cf.expense.living.car", "cf.expense.lumpSum.car", "cf.expense.other"],
};

/** 前に選んだが、今の種類では選べない行の名前の添え書き（世帯の値は書き換えず、そのまま見せて計算する） */
export const LEGACY_ROW_SUFFIX = "（前に選んだ行）";

/** 選べる表の行（種類ごと）。今入っている行が一覧に無ければ、添え書きを付けて後ろに残す */
function rowChoices(all: readonly Option[], allowed: readonly string[] | undefined, current: string | undefined): Option[] {
  // 並びは全部の一覧の順（どの種類でも同じ行は同じ順に出す）
  const list = allowed === undefined ? [...all] : all.filter((o) => allowed.includes(o.value));
  if (current !== undefined && !list.some((o) => o.value === current)) list.push({ value: current, label: `${all.find((o) => o.value === current)?.label ?? ROW_LABELS[current] ?? current}${LEGACY_ROW_SUFFIX}` });
  return list;
}

/** 入るお金の行の表の行の選択肢 */
export const incomeRowChoices = (f: Pick<IncomeFlow, "kind"> & { row?: string | undefined }): Option[] => rowChoices(IN_ROWS, f.kind === undefined ? undefined : IN_ROWS_BY_KIND[f.kind], f.row);
/** 出るお金の行の表の行の選択肢 */
export const expenseRowChoices = (p: Pick<PeriodicExpense, "kind"> & { row?: string | undefined }): Option[] => rowChoices(OUT_ROWS, p.kind === undefined ? undefined : OUT_ROWS_BY_KIND[p.kind], p.row);

/**
 * 相手（誰から・誰へ）を選ぶ意味のある種類（0044 の追記 2026-10-29）: お金が世帯の外の家族・贈与者・前の配偶者などの人から来る（人へ行く）種類。
 * 相手が亡くなる見込みの月から止める・世帯の外の家族の財布から出す、に使う。働く収入・年金・給付・売却などは人から来ないので欄を出さない
 * （前に相手を入れた行は、欄を残して見せる）
 */
const IN_PARTY: ReadonlySet<IncomeFlowKind> = new Set(["inheritance", "giftReceived", "support", "educationSupport", "childSupport", "propertyDivision", "householdContribution", "celebration", "other"]);
const OUT_PARTY: ReadonlySet<MoneyOutKind> = new Set(["childSupport", "allowance", "gift", "other"]);
export const incomeHasParty = (f: Pick<IncomeFlow, "kind" | "counterparty">): boolean => (f.counterparty !== undefined && f.counterparty !== "") || (f.kind !== undefined && IN_PARTY.has(f.kind));
export const expenseHasParty = (p: Pick<PeriodicExpense, "kind" | "counterparty">): boolean => (p.counterparty !== undefined && p.counterparty !== "") || (p.kind !== undefined && OUT_PARTY.has(p.kind));

/** 入るお金の種類を選び直した後: 表の行がその種類で選べなければ外す（種類の既定の行に戻す） */
function fixIncomeRow(t: Obj): void {
  const f = t as unknown as IncomeFlow;
  const allowed = f.kind === undefined ? undefined : IN_ROWS_BY_KIND[f.kind];
  if (f.row !== undefined && allowed !== undefined && !allowed.includes(f.row)) delete (t as { row?: string }).row;
}

/** 出るお金の種類を選び直した後: 表の行がその種類で選べなければ、その種類の既定の行にする（足すときは表の行を書くので、既定の行を書く） */
function fixExpenseRow(t: Obj): void {
  const p = t as unknown as PeriodicExpense;
  const allowed = p.kind === undefined ? undefined : OUT_ROWS_BY_KIND[p.kind];
  if (allowed !== undefined && (p.row === undefined || !allowed.includes(p.row))) (t as { row?: string }).row = outKind(p.kind).row;
}

/**
 * お金の行の額の呼び方（額の欄・必要経費の欄・変化のボタンで同じ。0044 の 2026-10-29 の追記）: 毎月の行は「月額」、毎年の行は「年額」、
 * 数年ごとの行は「3年ごとの額」、1回の行は「額」
 */
export function amountName(c: Cadence, everyYears: number): string {
  if (c === "monthly") return "月額";
  if (c === "once") return "額";
  return everyYears > 1 ? `${everyYears}年ごとの額` : "年額";
}

/** 年ごとの行の額の欄の説明（何年ごとの間隔ごとの1回の額） */
const everyAmountHelp = (everyYears: number): string => (everyYears > 1 ? `${everyYears}年ごとに1回の額です（何年ごとの欄の間隔ごと）` : "毎年の額です（何年ごとを2以上にすると、その年数ごとの1回の額になります）");

/** 必要経費・取得費の欄の名前（額の欄と同じ呼び方: 「必要経費（月額）」「必要経費（年額）」「必要経費（3年ごとの額）」、1回の行は「必要経費」） */
function costLabel(tax: IncomeTaxTreatment, c: Cadence, everyYears: number): string {
  const what = tax === "capitalGains" ? "取得費・譲渡の費用" : "必要経費";
  return c === "once" ? what : `${what}（${amountName(c, everyYears)}）`;
}

/** 必要経費・取得費の欄の説明 */
function costHelp(tax: IncomeTaxTreatment, c: Cadence, everyYears: number): string {
  const unit = c === "once" ? "受け取る額と同じく、その1回の分" : `受け取る額と同じく${amountName(c, everyYears)}`;
  return `${tax === "capitalGains" ? "受け取る額から引く取得費と譲渡の費用" : "受け取る額から引く経費"}です。${unit}で、今の値段で入れます（受け取る額が伸びると、同じ割合で伸ばします）`;
}

/** 前に選んだ行が今の種類で選べないときの説明 */
const LEGACY_ROW_HELP = "「前に選んだ行」は、今はこの種類で選べない行です。そのまま計算しています（選び直すと一覧から消えます）";
const rowHelp = (legacy: boolean): { help?: string } => (legacy ? { help: LEGACY_ROW_HELP } : {});

/** 雑所得（業務・その他）の効き方（0086: 公的年金等以外の雑所得は1つの区分として差し引く） */
const MISC_EFFECT = "収入から必要経費を引いた額を、受け取る人の雑所得に足します。赤字はほかの雑所得と公的年金からだけ引き、給与などほかの所得からは引きません";

/**
 * 副業の所得の区分の選択肢（0086）: 雑所得（業務）か事業所得か。既定は雑所得（業務）。副業の多くは雑所得として申告され、
 * 帳簿を付けて事業として続けているときに事業所得になる（所得税基本通達35-2）
 */
const SIDE_JOB_TAX: readonly IncomeTaxTreatment[] = ["miscBusiness", "business"];
const SIDE_JOB_TAX_HELP = "副業の多くは雑所得（業務）です。帳簿を付けて事業として続けている（開業の届けを出して青色申告をしているなど）なら事業所得を選びます。事業所得は、赤字を給与などほかの所得から引け、青色申告の特別控除も受けられます";

/** 課税の扱い（9通り）と、結果への効き方の一文 */
export const TAX_TREATMENTS: readonly { value: IncomeTaxTreatment; label: string; effect: string }[] = [
  { value: "nonTaxable", label: "非課税", effect: "所得税・住民税はかかりません" },
  { value: "temporary", label: "一時所得", effect: "必要経費を引き、ほかの一時所得と合わせて特別控除（50万円まで）を引いた2分の1を、受け取る人の所得に足します" },
  { value: "miscBusiness", label: "雑所得（業務）", effect: MISC_EFFECT },
  { value: "miscOther", label: "雑所得（その他）", effect: MISC_EFFECT },
  { value: "salary", label: "給与（社会保険なし）", effect: "本業の給与と合わせて給与所得にします。社会保険料はかけません" },
  { value: "business", label: "事業所得", effect: "収入から必要経費を引いた額を、受け取る人の事業所得に足します。赤字は給与などほかの所得から引きます。青色申告なら特別控除も引きます" },
  { value: "capitalGains", label: "譲渡所得（分離）", effect: "収入から取得費を引いた額に、所得税（翌年3月）と住民税（翌年6月）をかけます（一般株式等の税率）" },
  { value: "inheritance", label: "相続税で見る", effect: "所得税・住民税はかかりません。相続税は計算しません（受け取る側の相続税の額は、出るお金の行で入れます）" },
  { value: "gift", label: "贈与税で見る", effect: "相手からの贈与として、受け取る人の贈与税を翌年3月に払います（直系尊属から18歳以上は特例税率）" },
];

/**
 * 札の選択肢は2つずつ（0044 の追記）: 見込みは「確実／当てにしない」、優先度は「必ず／できれば」。計算はもとから「たぶん＝確実」「希望＝夢」で
 * 同じ扱いなので、古い値（likely・wish）は同じ扱いの札で見せる（読み替えるだけで、世帯ファイルの値は書き換えない）。新しく選ぶと certain・uncertain・need・want を書く
 */
const LIKELIHOODS: Option[] = [
  { value: "certain", label: "確実" },
  { value: "uncertain", label: "当てにしない" },
];
const PRIORITIES: Option[] = [
  { value: "need", label: "必ず" },
  { value: "want", label: "できれば" },
];
export const LIKELIHOOD_LABEL: Record<string, string> = { likely: "確実", certain: "確実", uncertain: "当てにしない" };
export const PRIORITY_LABEL: Record<string, string> = { need: "必ず", want: "できれば", wish: "できれば" };
/** 札の古い値を、同じ扱いの選択肢の値で見せる（likely → certain、wish → want） */
const BADGE_ALIAS: Record<string, string> = { likely: "certain", wish: "want" };

/** 時期の入れ方: 1回／毎月／年ごと（年ごとは下の「何年ごと」で間隔を入れる。1は毎年） */
export type Cadence = "once" | "monthly" | "repeat";
const CADENCES: Option[] = [
  { value: "once", label: "1回" },
  { value: "monthly", label: "毎月" },
  { value: "repeat", label: "年ごと" },
];

const incomeKind = (k: IncomeFlowKind | undefined) => INCOME_KINDS.find((x) => x.kind === k) ?? (INCOME_KINDS.at(-1) as (typeof INCOME_KINDS)[number]);
const outKind = (k: MoneyOutKind | undefined) => OUT_KINDS.find((x) => x.kind === (k ?? "general")) ?? (OUT_KINDS[0] as (typeof OUT_KINDS)[number]);

/** 入るお金の行の課税の扱い（省略は種類の既定） */
export const incomeTreatment = (f: Pick<IncomeFlow, "kind" | "taxTreatment">): IncomeTaxTreatment => f.taxTreatment ?? incomeKind(f.kind).tax;

/** 行の時期の入れ方 */
export function cadenceOf(h: Household, r: { from: Timepoint; to?: Timepoint | null; monthly?: boolean; everyYears: number }): Cadence {
  if (r.monthly === true) return "monthly";
  if (r.everyYears === 1 && r.to != null) {
    const a = resolveTimepoint(h, r.to);
    if (a !== null && a === resolveTimepoint(h, r.from)) return "once";
  }
  return "repeat";
}

/** 入るお金の行の表の行（省略は種類の既定） */
export const incomeRowOf = (h: Household, f: IncomeFlow): string => f.row ?? (cadenceOf(h, f) === "once" ? incomeKind(f.kind).once : incomeKind(f.kind).repeat);

/** 世帯の外の家族か（贈与者は画面の中では donors。生年月の無い世帯の外の家族） */
const isOutside = (m: Member) => m.outside !== undefined;

/** 入るお金の行の属するカード */
export const incomeCard = (f: Pick<IncomeFlow, "kind">): MoneyCard => incomeKind(f.kind).card;

/** 出るお金の行の属するカード（種類の無い行はライフイベント。仕送りは相手が親・祖父母なら介護・親、それ以外は家族） */
export function expenseCard(h: Household, p: Pick<PeriodicExpense, "kind" | "counterparty">): MoneyCard {
  if (p.kind === "allowance") {
    const who = h.members.find((m) => m.id === p.counterparty);
    const donor = (h.donors ?? []).find((d) => d.id === p.counterparty);
    return who === undefined && donor === undefined ? "care" : who?.kind === "parent" || who?.kind === "grandparent" || donor !== undefined ? "care" : "family";
  }
  return outKind(p.kind).card;
}

/** カードの区画に出す種類（入る・出る） */
export function kindsOf(card: MoneyCard): { incomes: (typeof INCOME_KINDS)[number][]; outs: (typeof OUT_KINDS)[number][] } {
  return {
    incomes: INCOME_KINDS.filter((k) => k.card === card),
    // 夢は夢プランの区画だけで足す（種類の選択・「＋」の一覧には出さない。0103）
    outs: OUT_KINDS.filter((k) => k.kind !== "dream" && (k.card === card || (card === "family" && k.kind === "allowance"))),
  };
}

const incomes = (h: Household) => h.incomeFlows;
const periodic = (h: Household) => h.periodicExpenses;
const address = (id: string, item: string, at: string[] = []): (() => Address) => () => ({ target: { object: id }, item, at });
const withAddress = (f: FieldDef, a: () => Address): FieldDef => ({ ...f, address: a });

/** 相手に選べる人（世帯の外の家族と、贈与者として入れた人。家族のカードの行は、本人のほかの世帯の人〔前の配偶者・離れて暮らす子〕も） */
function counterpartyOptions(wh: WorkingHousehold, card?: MoneyCard): Option[] {
  const h = wh.request.input.household;
  const out: Option[] = [{ value: "", label: "なし" }];
  if (card === "family") for (const m of h.members.filter((x) => !isOutside(x) && x.kind !== "self" && x.expected !== true)) out.push({ value: m.id, label: memberLabel(wh, m.id) });
  for (const m of h.members.filter(isOutside)) out.push({ value: m.id, label: memberLabel(wh, m.id) });
  for (const d of h.donors ?? []) out.push({ value: d.id, label: d.kind === "grandparent" ? "祖父母（贈与者）" : d.kind === "parent" ? "親（贈与者）" : "その他の家族（贈与者）" });
  return out;
}

/** 受け取る人・払う人に選べる人（世帯の中の構成員。既定は世帯） */
function insiderOptions(wh: WorkingHousehold): Option[] {
  const h = wh.request.input.household;
  return [{ value: "", label: "世帯" }, ...h.members.filter((m) => !isOutside(m) && m.expected !== true).map((m) => ({ value: m.id, label: memberLabel(wh, m.id) }))];
}

/** 本人（年齢で入れる時点の既定の人） */
const selfAge = (wh: WorkingHousehold) => {
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  return self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {};
};

// ---- 養育費の行（0044 の追記）: 相手は養育を受ける子。払う行は世帯の外の子（離れて暮らす子）、受け取る行は世帯の中の子 ----

/**
 * 養育費の終わりの既定: 相手の子が20歳になる月まで。取り決めでいちばん多い終わりで、成年年齢が18歳になった後も養育費は20歳までと
 * する扱いが多い（成年年齢の引き下げで養育費の終わりが18歳に早まるわけではない）。大学を卒業するまでと決めるときは22歳の年度末
 */
export const childSupportEnd = (child: string): Timepoint => ({ memberAge: { member: child, years: 20 } });
/** 大学を卒業するまで（22歳に達した後の最初の3月） */
export const childSupportUniversityEnd = (child: string): Timepoint => ({ memberAge: { member: child, years: 22, ageSwitch: "firstMarch31AfterReach" } });

type SupportRow = { id: string; to?: Timepoint | null; counterparty?: string };

/** 養育費の行の相手の子（相手が子でなければ undefined。古い世帯の、前の配偶者を相手にした行など） */
const supportChild = (h: Household, r: { counterparty?: string }): Member | undefined => h.members.find((m) => m.id === r.counterparty && m.kind === "child");

/** 養育費の相手にできる子（払う: 世帯の外の子。受け取る: 世帯の中の子。これから生まれる子は入れない） */
const supportKids = (h: Household, dir: "in" | "out"): Member[] => h.members.filter((m) => m.kind === "child" && m.expected !== true && (dir === "out" ? isOutside(m) : !isOutside(m)));

/** 養育費の相手に選べる子。今入っている相手が一覧に無ければ（古い世帯の前の配偶者など）、それも残して見せる（黙って書き換えない） */
function childSupportOptions(wh: WorkingHousehold, dir: "in" | "out", current: string | undefined): Option[] {
  const h = wh.request.input.household;
  const out: Option[] = [{ value: "", label: "なし（まだ選ばない）" }, ...supportKids(h, dir).map((m) => ({ value: m.id, label: dir === "out" ? `${memberLabel(wh, m.id)}（離れて暮らす子）` : memberLabel(wh, m.id) }))];
  if (current !== undefined && current !== "" && !out.some((o) => o.value === current) && h.members.some((m) => m.id === current)) out.push({ value: current, label: memberLabel(wh, current) });
  return out;
}

/**
 * 養育費の相手の子を選んだ後の終わり: 終わりが空（最後まで）なら、その子が20歳になる月にする。別の子の年齢で入っていたら、同じ年齢の決まりのまま
 * 選んだ子に付け替える（年月で入れた終わりはそのまま）
 */
export function followSupportEnd(h: Household, row: { to?: Timepoint | null }, child: string | undefined): void {
  if (child === undefined || !h.members.some((m) => m.id === child && m.kind === "child")) return;
  const to = row.to;
  if (to === null || to === undefined) {
    row.to = childSupportEnd(child);
    return;
  }
  const a = to.memberAge;
  if (a !== undefined && a.member !== child && h.members.find((m) => m.id === a.member)?.kind === "child") row.to = { memberAge: { ...a, member: child } };
}

/** 養育費の相手と終わりの既定を入れる（相手の子がいなければ何もしない） */
export function setSupportChild(h: Household, row: { to?: Timepoint | null; counterparty?: string }, child: string | undefined): void {
  if (child === undefined) return;
  row.counterparty = child;
  followSupportEnd(h, row, child);
}

/** 養育費の相手の既定の子: 払う行は世帯の外の子、受け取る行は世帯の中の子のうち、いちばん下の子 */
export function defaultSupportChild(h: Household, dir: "in" | "out"): string | undefined {
  return [...supportKids(h, dir)].sort((a, b) => b.birth.birthYearMonth.localeCompare(a.birth.birthYearMonth))[0]?.id;
}

/** 世帯の外の子（離れて暮らす子・前の結婚の子）を足す。生年月は仮の値（払う養育費の行の「相手の子の生年月」で直す）。性別は推定の印を付けない */
export function addOutsideChild(wh: WorkingHousehold, id: string = newId()): WorkingHousehold {
  const base = wh.request.input.baseMonth;
  const next = mutate(wh, (h) => {
    const self = h.members.find((m) => m.kind === "self");
    if (self === undefined) return;
    const year = Math.min(Number(base.slice(0, 4)), Number(self.birth.birthYearMonth.slice(0, 4)) + 30);
    h.members.push({ id, kind: "child", birth: { birthYearMonth: `${String(year)}-04`, bornOnFirst: false }, sex: "male", joins: null, leaves: null, expected: false, outside: { of: self.id, periods: [] } } as Member);
    (h.relations ??= []).push({ type: "parentOf", parent: self.id, child: id });
  });
  if (!next.request.input.household.members.some((m) => m.id === id)) return next;
  return { ...next, assumed: { ...next.assumed, [`family/${id}/birth`]: "仮の値" } };
}

/** 養育費の行の相手の欄（簡易）。選ぶと終わりを相手の子の年齢に合わせる */
function supportPartyField(wh: WorkingHousehold, dir: "in" | "out", key: string, item: string, find: Finder, id: string, current: string | undefined): FieldDef {
  return withAddress(
    plain({
      key,
      item,
      label: dir === "out" ? "相手の子（離れて暮らす子）" : "養育費を受ける子",
      level: "simple",
      kind: "select",
      options: childSupportOptions(wh, dir, current),
      find,
      path: ["counterparty"],
      optional: true,
      fallback: "",
      after: (h, t, v) => followSupportEnd(h, t as { to?: Timepoint | null }, typeof v === "string" && v !== "" ? v : undefined),
      help:
        dir === "out"
          ? "養育を受ける子を選びます。終わりの既定はその子が20歳になる月です。いない子は「＋ 離れて暮らす子を足す」で足せます（介護・親の入力項目の「世帯の外の家族」に入ります）。受け取る人（前の配偶者）は計算には使わないので、名前の欄にメモとして書けます"
          : "養育を受ける子を選びます。終わりの既定はその子が20歳になる月です。払う人（前の配偶者）は計算には使わないので、名前の欄にメモとして書けます",
    }),
    address(id, item),
  );
}

/** 養育費の行の終わりの欄の説明 */
const SUPPORT_END_HELP = "既定は相手の子が20歳になる月までです（養育費の取り決めでいちばん多い終わり）。大学を卒業するまでと決めているなら「終わりを大学卒業（22歳の年度末）にする」で直せます";
/** 養育費の行の終わりが空（最後まで）のときの知らせ */
const supportEndWarn = (find: Finder) => (wh: WorkingHousehold) => {
  const r = find(wh.request.input.household, wh) as { to?: Timepoint | null } | undefined;
  return r !== undefined && (r.to === null || r.to === undefined) ? "終わりが「最後まで」です。相手の子を選ぶか、終わりを入れてください" : null;
};

/** 養育費の行の時点の欄の年齢の目安は、相手の子で見せる（相手が子でなければ本人） */
const supportAge = (wh: WorkingHousehold, r: { counterparty?: string }) => {
  const kid = supportChild(wh.request.input.household, r);
  return kid === undefined ? selfAge(wh) : { ageOf: (h: Household) => h.members.find((m) => m.id === kid.id) };
};

/** 養育費の行のボタン: 離れて暮らす子を足す（払う行で相手が世帯の外の子でないとき）・終わりの切り替え（20歳になる月／大学卒業） */
function supportActions(wh: WorkingHousehold, dir: "in" | "out", k: string, r: SupportRow, list: (h: Household) => SupportRow[] | undefined): ActionDef[] {
  const kid = supportChild(wh.request.input.household, r);
  const out: ActionDef[] = [];
  const edit = (w: WorkingHousehold, fn: (hh: Household, row: SupportRow) => void) =>
    mutate(w, (hh) => {
      const row = (list(hh) ?? []).find((x) => x.id === r.id);
      if (row !== undefined) fn(hh, row);
    });
  if (dir === "out" && (kid === undefined || !isOutside(kid)))
    out.push({
      key: `${k}/addChild`,
      label: "＋ 離れて暮らす子を足す（この行の相手に）",
      level: "simple",
      run: (w) => {
        const id = newId();
        return edit(addOutsideChild(w, id), (hh, row) => {
          if (hh.members.some((m) => m.id === id)) setSupportChild(hh, row, id);
        });
      },
    });
  if (kid !== undefined) {
    const a = r.to?.memberAge;
    const of = a !== undefined && a.member === kid.id && (a.months ?? 0) === 0;
    const is20 = of && a.years === 20 && (a.ageSwitch ?? "reachMonth") === "reachMonth";
    const is22 = of && a.years === 22 && a.ageSwitch === "firstMarch31AfterReach";
    if (!is22) out.push({ key: `${k}/endUniversity`, label: "終わりを大学卒業（22歳の年度末）にする", level: "simple", run: (w) => edit(w, (_hh, row) => void (row.to = childSupportUniversityEnd(kid.id))) });
    if (!is20) out.push({ key: `${k}/end20`, label: "終わりを20歳になる月にする", level: "simple", run: (w) => edit(w, (_hh, row) => void (row.to = childSupportEnd(kid.id))) });
  }
  return out;
}

/** 払う養育費の行に出す、相手の子（世帯の外の子）の生年月の欄。同じ子を相手にした行が2つ以上あれば、最初の行にだけ出す */
function supportChildBirth(wh: WorkingHousehold, p: PeriodicExpense): FieldDef | null {
  const h = wh.request.input.household;
  const kid = supportChild(h, p);
  if (kid === undefined || !isOutside(kid)) return null;
  const first = (h.periodicExpenses ?? []).find((x) => x.kind === "childSupport" && x.counterparty === kid.id);
  if (first?.id !== p.id) return null;
  const base = wh.request.input.baseMonth;
  const f = plain({
    key: `family/${kid.id}/birth`,
    item: "member.birth",
    label: "相手の子の生年月",
    level: "simple",
    kind: "ym",
    find: byId((hh) => hh.members, kid.id),
    path: ["birth", "birthYearMonth"],
    help: "終わり（20歳になる月など）はこの生年月で決まります。介護・親の入力項目の「世帯の外の家族」と同じ欄です",
    hint: (v) => {
      if (typeof v !== "string") return null;
      const age = ageAt({ ...kid, birth: { ...kid.birth, birthYearMonth: v } }, base);
      return age < 0 ? readYearMonth(v, base) : `${String(age)}歳（${wareki(v)}）`;
    },
  });
  return withAddress(f, () => ({ target: { member: kid.id }, item: "member.birth", at: ["birthYearMonth"] }));
}


/**
 * 払う養育費の行の相手の子（世帯の外の子）を、扶養親族に入れるかの欄（0044 の追記）。生年月の欄と同じく、同じ子を相手にした最初の行にだけ出す。
 * 当て先は構成員の扶養（member.support.dependent。介護・親の項目の親・祖父母と同じ値）。既定は入れない（同じ子を両方の親が扶養控除に
 * 入れることはできないので、FP が確かめたときだけ入れる）。計算は、その子への養育費・仕送りの行がその年の12月31日を含む年だけ扶養親族にする
 */
function supportDependentField(wh: WorkingHousehold, p: PeriodicExpense): FieldDef | null {
  const h = wh.request.input.household;
  const kid = supportChild(h, p);
  if (kid === undefined || !isOutside(kid)) return null;
  const first = (h.periodicExpenses ?? []).find((x) => x.kind === "childSupport" && x.counterparty === kid.id);
  if (first?.id !== p.id) return null;
  const f = plain({
    key: `family/${kid.id}/dependent`,
    item: "member.support",
    label: "扶養している（税）",
    level: "detail",
    kind: "bool",
    find: byId((hh) => hh.members, kid.id),
    path: ["support", "dependent"],
    ensure: (hh) => {
      const x = hh.members.find((y) => y.id === kid.id) as Member;
      x.support ??= { dependent: false, cohabiting: false };
      return x as unknown as Obj;
    },
    after: (_h, t) => {
      const s = t.support as { dependent?: boolean; cohabiting?: boolean } | undefined;
      if (s === undefined) return;
      s.dependent ??= false;
      s.cohabiting ??= false;
    },
    optional: true,
    fallback: false,
    help: supportDependentHelp(h, kid, p, wh.request.input.baseMonth),
  });
  return withAddress(f, () => ({ target: { member: kid.id }, item: "member.support", at: ["dependent"] }));
}

/** 扶養控除の始まりの年齢（16歳）と特定扶養親族の年齢（19〜22歳）。エンジンの制度の値と同じ（その年の12月31日の年齢） */
const DEPENDENT_FROM_AGE = 16;

/**
 * 扶養している（税）の欄の説明と、効く年の目安。効くのは、その年の12月31日に16歳以上で、養育費の行がその年の12月を含む年（行の始まりの年から、
 * 終わりが12月でなければ終わりの前の年まで）
 */
export function supportDependentHelp(h: Household, kid: Member, p: PeriodicExpense, baseMonth: string): string {
  const head =
    "離れて暮らす子に養育費を払っている間は、払う側の扶養親族にできることがあります（生計を一にする）。同じ子を両方の親が扶養控除に入れることはできないので、既定は入れません。もう一方の親が入れていないことを確かめたときだけ入れてください。扶養控除は16歳から（19〜22歳は特定扶養親族）で、養育費を払っている年（その年の12月31日に払っている年）だけ効きます。養育費が終わった後も仕送りを続けるなら、仕送りの行を足すと続けて効きます。子の所得が扶養の上限を超える年と、夫婦のうち所得の少ない方の控除には入りません";
  const years = supportDependentYears(h, kid, p, baseMonth);
  return years === null ? head : `${head}。${years}`;
}

/** 効く年の目安の文（「効く年の目安: 2032年（16歳）から2036年（20歳）まで」。計算の基準の年より前は数えない）。生年月や行の時期が分からなければ null */
export function supportDependentYears(h: Household, kid: Member, p: PeriodicExpense, baseMonth: string): string | null {
  const birth = Number(kid.birth.birthYearMonth.slice(0, 4));
  const from = resolveTimepoint(h, p.from);
  if (!Number.isFinite(birth) || from === null) return null;
  const start = Math.max(birth + DEPENDENT_FROM_AGE, Number(from.slice(0, 4)), Number(baseMonth.slice(0, 4)));
  const to = p.to == null ? null : resolveTimepoint(h, p.to);
  const end = to === null ? null : Number(to.slice(5, 7)) === 12 ? Number(to.slice(0, 4)) : Number(to.slice(0, 4)) - 1;
  if (end !== null && end < start) return "この行の間は、その年の12月31日に16歳以上の年が無いので、扶養控除は効きません";
  const startText = `${String(start)}年（${String(start - birth)}歳）から`;
  return `効く年の目安: ${startText}${end === null ? "行の終わりまで" : `${String(end)}年（${String(end - birth)}歳）まで`}`;
}

// ---- 時期・何年ごとを変えたときの額の直し方（0100 の追記） ----

/** 1年に何回か（毎月は12回、何年かごとの行は「1÷何年ごと」回）。1回は年あたりが無いので null */
const timesPerYear = (c: Cadence, every: number): number | null => (c === "monthly" ? 12 : c === "repeat" ? 1 / Math.max(1, every) : null);
/** 直した額の根拠・知らせの文の頭（入れ直すたびに前の文を外して付け直す） */
const REEXPRESSED = "時期に合わせて直した額";
const perText = (c: Cadence, every: number) => (c === "monthly" ? "月額" : every === 1 ? "年額" : `${every}年ごとの額`);
const manYen = (v: number) => `${(Math.round(v / 1000) / 10).toLocaleString("ja-JP")}万円`;

/**
 * 時期（毎月／年ごと）・何年ごとを変えたときに、行の額（元の額・段階の額・例外の年の額）を、年あたりが同じになるように言い直す。
 * - 推定（と「わからない」の代わりの値）: 言い直して推定の印のまま、根拠に「時期に合わせて直した額」を足す（毎月は100円、年ごとは千円の単位に丸める）
 * - FP が入れた値: 時期（毎月 ↔ 年ごと）を変えたときだけ言い直し（額の単位が変わるため。1円の単位）、欄の下に1行の知らせを出す（確定のまま。根拠に前の額を書く）。
 *   何年ごとだけを変えたときは変えない（1回あたりの額は FP が知っている額のため）
 * - 1回の行との間は年あたりが無いので変えない
 */
export function reexpressAmounts(r: Obj, from: { c: Cadence; every: number }, to: { c: Cadence; every: number }): void {
  const a = timesPerYear(from.c, from.every);
  const b = timesPerYear(to.c, to.every);
  if (a === null || b === null || a === b) return;
  const factor = a / b;
  const unitChanged = (from.c === "monthly") !== (to.c === "monthly");
  const step = to.c === "monthly" ? 100 : 1000;
  const toText = perText(to.c, to.every);
  const fromText = perText(from.c, from.every);
  // 推定の根拠には、元の時期の言い方を残す（元の時期に戻したら根拠も元に戻る）
  const SUFFIX = new RegExp(`（${REEXPRESSED}。元は([^）]*)）$`, "u");
  const rebasis = (s: string): string => {
    const m = SUFFIX.exec(s);
    const head = m === null ? s : s.slice(0, m.index);
    const original = m?.[1] ?? fromText;
    return original === toText ? head : `${head}（${REEXPRESSED}。元は${original}）`;
  };
  const redo = (box: unknown): void => {
    if (typeof box !== "object" || box === null) return;
    const x = box as Obj & { value?: number; state?: string; estimate?: { method: string; basis: string }; substitute?: Obj & { value?: number; estimate?: { method: string; basis: string } } };
    // 0円（未入力の0円の推定など）は直すものが無い
    if (typeof x.value === "number" && x.value === 0) return;
    if (x.state === "estimated" && typeof x.value === "number") {
      x.value = Math.round((x.value * factor) / step) * step;
      x.estimate = { method: x.estimate?.method ?? "derived", basis: rebasis(x.estimate?.basis ?? "推定") };
    } else if (x.state === "unknown" && x.substitute !== undefined && typeof x.substitute.value === "number") {
      x.substitute.value = Math.round((x.substitute.value * factor) / step) * step;
      x.substitute.estimate = { method: x.substitute.estimate?.method ?? "derived", basis: rebasis(x.substitute.estimate?.basis ?? "推定") };
    } else if (x.state === "confirmed" && typeof x.value === "number" && unitChanged) {
      const before = `${fromText} ${manYen(x.value)}`;
      x.value = Math.round(x.value * factor);
      x.estimate = { method: "derived", basis: `${REEXPRESSED}。年あたりが同じになるよう、${before}を${toText}に直しました` };
    }
  };
  redo(r.amount);
  for (const s of (r.stages as Obj[] | undefined) ?? []) redo(s.amount);
  for (const e of (r.exceptions as Obj[] | undefined) ?? []) redo(e.amount);
}

/** 額の欄の下の1行の知らせ（FP が入れた値を時期に合わせて直したとき。打ち直すと消える） */
export function reexpressedNote(box: unknown): string | null {
  if (typeof box !== "object" || box === null) return null;
  const x = box as { state?: string; estimate?: { basis?: string } };
  const b = x.estimate?.basis;
  return x.state === "confirmed" && b !== undefined && b.startsWith(REEXPRESSED) ? b.slice(REEXPRESSED.length + 1) : null;
}

/** 何年ごとの欄（直すと、推定の額は年あたりが同じになるよう言い直す。FP が入れた額は変えない） */
export function everyField(key: string, item: string, find: Finder, help: string): FieldDef {
  const f = plain({ key, item, label: "何年ごと", level: "simple", kind: "int", suffix: "年ごと", min: 1, max: 50, find, path: ["everyYears"], help });
  return {
    ...f,
    set: (wh, v) => {
      const before = Number(f.get(wh).value ?? 1);
      const next = f.set(wh, v);
      if (v === null || next === wh || Number(v) === before) return next;
      return mutate(next, (h) => {
        const r = find(h, next) as unknown as Obj | undefined;
        if (r !== undefined) reexpressAmounts(r, { c: "repeat", every: before }, { c: "repeat", every: Number(v) });
      });
    },
  };
}

/**
 * 時期の入れ方の欄（1回／毎月／年ごと）。1回は終わりを始まりと同じ月に、毎月は monthly を立てる（何年ごとは1）。年ごとに変えると、何年ごとは
 * 1（毎年）から始まる。1回・毎月に変えると何年ごとの欄は消えるので、何年ごとの仮の印（ひな形の推定）も外す
 */
export function cadenceField(key: string, item: string, find: Finder, id: string, o: { noMonthly?: { help: string; legacy: string; monthlyNow: boolean } } = {}): FieldDef {
  // 毎月を選べない行（修繕・リフォーム）: 前の版で毎月にした行だけ、読めるように「毎月」を残して知らせる
  const nm = o.noMonthly;
  const options = nm === undefined ? CADENCES : nm.monthlyNow ? CADENCES.map((c) => (c.value === "monthly" ? { ...c, label: "毎月（前の版の入れ方）" } : c)) : CADENCES.filter((c) => c.value !== "monthly");
  return withAddress(
    field({
      key,
      item,
      label: "時期",
      level: "simple",
      kind: "select",
      options,
      structural: true,
      ...(nm !== undefined ? { help: nm.help } : {}),
      get: (wh) => {
        const r = find(wh.request.input.household, wh) as unknown as PeriodicExpense | undefined;
        const c = r === undefined ? null : cadenceOf(wh.request.input.household, r);
        return { value: c, ...(nm !== undefined && c === "monthly" ? { hint: nm.legacy } : {}) };
      },
      set: (wh, v) => {
        const next = mutate(wh, (h) => {
          const r = find(h, wh) as unknown as (PeriodicExpense & Obj) | undefined;
          if (r === undefined) return;
          const was = cadenceOf(h, r);
          const wasEvery = r.everyYears;
          if (v === "once") {
            delete r.monthly;
            r.everyYears = 1;
            r.to = structuredClone(r.from);
          } else {
            if (was === "once") r.to = null;
            if (v === "monthly") {
              r.monthly = true;
              r.everyYears = 1;
            } else delete r.monthly;
          }
          // 毎月 ↔ 年ごとは、年あたりが同じになるよう額を言い直す（0100 の追記）
          if (v === "monthly" || v === "repeat") reexpressAmounts(r, { c: was, every: wasEvery }, { c: v, every: r.everyYears });
        });
        return v === "repeat" ? next : withoutAssumedKey(next, key.replace(/\/cadence$/, "/every"));
      },
    }),
    address(id, item),
  );
}

/** 修繕・リフォームの行の時期（毎月は選べない。毎月かかる分は住まいの修繕の積み立て・管理費の欄で入れる） */
const REPAIR_CADENCE_HELP = "外壁・屋根・水回りなどの大きな修繕を、1回か年ごと（10年ごとなど）で入れます。毎月の積み立て・管理費は、住まいの「修繕の積み立て（毎月）」（マンションは「管理費・修繕積立金（毎月）」）の欄で入れます";
/** 前の版で毎月にした修繕・リフォームの行の知らせ（毎月のまま計算する） */
const REPAIR_MONTHLY_LEGACY = "前の版で「毎月」にした行です。今の額を毎月として計算しています。毎月の分は住まいの修繕の積み立ての欄に移し、この行は1回か年ごとに直してください";

/** 年ごとの行の何年ごとの欄の説明（1から50まで。1は毎年） */
const EVERY_HELP = "1なら毎年、2以上ならその年数ごとです（50年まで）";

/** 仮の印を1つ外す（無ければそのまま） */
const withoutAssumedKey = (wh: WorkingHousehold, key: string): WorkingHousehold =>
  wh.assumed[key] === undefined ? wh : { ...wh, assumed: Object.fromEntries(Object.entries(wh.assumed).filter(([k]) => k !== key)) };

/**
 * 札（見込み）の欄。ライフイベントのカードの入るお金の行では詳細（今の結果には効かず、「確実な分だけ」の見方でだけ効く。既定の確実のままで
 * 結果は同じ。0078）。ほかのカード（受け取る相続の見込みは基本の計算に入れるかが決まる）は標準。出るお金の行の優先度は、どのカードでも標準
 */
const badgeLevel = (card: MoneyCard): Level => (card === "events" ? "detail" : "simple");
/** 行の名前の欄。相続・贈与のカードの行は詳細（名前が空なら種類の名前を見出しに出し、相手は標準の欄で選ぶ。0078） */
const nameLevel = (card: MoneyCard): Level => (card === "inherit" ? "detail" : "simple");
function badgeField(key: string, item: string, label: string, options: Option[], fallback: string, find: Finder, path: string, id: string, help: string, level: Level): FieldDef {
  return withAddress(aliasBadge(plain({ key, item, label, level, kind: "select", options, find, path: [path], optional: true, fallback, help })), address(id, item));
}

/**
 * 札の欄の古い値（likely・wish）を、同じ扱いの選択肢で見せる（読むだけ）。見せている値をそのまま入れ直しても書き換えない
 * （古い値は黙って書き換えない。別の札を選び直したときだけ書く）
 */
function aliasBadge(f: FieldDef): FieldDef {
  const { get, set } = f;
  const alias = (v: unknown) => (typeof v === "string" ? BADGE_ALIAS[v] : undefined);
  return {
    ...f,
    get: (wh) => {
      const s = get(wh);
      const a = alias(s.value);
      return a !== undefined ? { ...s, value: a } : s;
    },
    set: (wh, v) => (v !== null && alias(get(wh).value) === v ? wh : set(wh, v)),
  };
}

/** 伸び方の欄（物価に合わせる＝既定／決まった率〔マイナスも〕／変えない） */
export function growthFields(key: string, item: string, find: Finder, id: string, cur: { kind: string; rate?: string } | undefined): FieldDef[] {
  const out = [withAddress(plain({ key: `${key}/growth`, item, label: "伸び方", level: "detail", kind: "select", options: GROWTH_KINDS, find, path: ["growth", "kind"], fallback: "inflation", optional: true, structural: true, after: (_h, t, v) => fixGrowth(t, v), help: "額は今の値段で入れます。選ばないときは、毎年、物価の上がり方に合わせて伸ばします" }), address(id, item, ["kind"]))];
  if (cur?.kind === "rate") out.push(withAddress(plain({ key: `${key}/growthRate`, item, label: "決まった変動率（年）", help: "マイナスも入れられます", level: "detail", kind: "pct", ...GROWTH_RANGE, find, path: ["growth", "rate"] }), address(id, item, ["rate"])));
  return out;
}

/** 伸び方を選び直したときの始末（決まった率なら率を置き、ほかは率を消す。stages/living.ts の fixGrowth と同じ） */
function fixGrowth(t: Obj, v: unknown): void {
  const g = t.growth as { kind?: string; rate?: string } | undefined;
  if (g === undefined) return;
  if (v === "rate") g.rate ??= "0.01";
  else delete g.rate;
  if (g.kind === undefined) delete t.growth;
}

/** 金額の文字（「30万円」「1,234円」） */
function yenText(v: number): string {
  if (v >= 10000 && v % 1000 === 0) return `${(v / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`;
  return `${v.toLocaleString("ja-JP")}円`;
}

/** 年月の文字（「2041年7月」） */
const ymText = (ym: string | null): string => (ym === null ? "" : `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`);

type RowShape = { amount: { value?: number | null }; from: Timepoint; to?: Timepoint | null; monthly?: boolean; everyYears: number };

/** 行の額と時期の文字: 額「2,000万円・1回」、時期「2041年7月」「2030年4月〜最後まで」（閉じた行の見出しと、結果の見方の一覧） */
export function rowParts(h: Household, r: RowShape): { amount: string; when: string } {
  const c = cadenceOf(h, r);
  const from = ymText(resolveTimepoint(h, r.from));
  const to = r.to == null ? "最後まで" : ymText(resolveTimepoint(h, r.to));
  const unit = c === "once" ? "1回" : c === "monthly" ? "毎月" : r.everyYears === 1 ? "毎年" : `${r.everyYears}年ごと`;
  return { amount: `${yenText(r.amount.value ?? 0)}・${unit}`, when: c === "once" ? from : `${from}〜${to}` };
}

/** 閉じた行の見出し: 「父からの相続 2,000万円・1回 2041年7月」（入る・出るはカードの区画で分かるので書かない） */
export function rowTitle(h: Household, name: string, r: RowShape): string {
  const p = rowParts(h, r);
  return `${name} ${p.amount} ${p.when}`;
}

/** 入るお金の行の名前（名前が空なら種類の名前） */
export const incomeName = (f: IncomeFlow): string => (f.label !== undefined && f.label !== "" ? f.label : incomeKind(f.kind).label);

/** 出るお金の行の名前（名前が空なら種類の名前。種類の無い行・ライフイベントの支出は時期で「一時的支出」「毎年の支出」「3年ごとの支出」「毎月の支出」） */
export function expenseName(h: Household, p: PeriodicExpense): string {
  if (p.label !== undefined && p.label !== "") return p.label;
  if (p.kind !== undefined && p.kind !== "general") return outKind(p.kind).label;
  return unnamedExpense(h, p);
}

/** 名前の無い行の呼び方（時期で決める） */
export function unnamedExpense(h: Household, p: Pick<PeriodicExpense, "from" | "to" | "monthly" | "everyYears">): string {
  const c = cadenceOf(h, p);
  if (c === "once") return "一時的支出";
  if (c === "monthly") return "毎月の支出";
  return p.everyYears > 1 ? `${String(p.everyYears)}年ごとの支出` : "毎年の支出";
}

/** 受け継ぐ借金の額と時期の文字（残高か借入額、借り始め） */
export function debtParts(h: Household, d: Debt): { amount: string; when: string } {
  const from = ymText(resolveTimepoint(h, d.start));
  return { amount: yenText(d.balance?.value ?? d.principal), when: from === "" ? "" : `${from}から` };
}

// ---- 入るお金の行 ----

/** 入るお金の行のまとまり（簡易の1行・詳細の3まとまり） */
/** 入るお金の行の「▸ 続きを見る」の文（開くと出る詳細のまとまり: 課税の扱いか必要経費〔無いこともある〕と、受け取る人・伸び方など） */
export function incomeMoreLabel(tax: "tax" | "cost" | null): string {
  return tax === "tax" ? "課税の扱い・受け取る人を入れる" : tax === "cost" ? "必要経費・受け取る人を入れる" : "受け取る人・伸び方を入れる";
}

export function incomeGroups(wh: WorkingHousehold, f: IncomeFlow, card: MoneyCard): GroupDef[] {
  const h = wh.request.input.household;
  const find = byId(incomes, f.id);
  const k = `in/${f.id}`;
  const kinds = kindsOf(card).incomes;
  const def = incomeKind(f.kind);
  const c = cadenceOf(h, f);
  const tax = incomeTreatment(f);
  const inherit = card === "inherit";
  const excluded = excludedIncome(f);
  const fields: FieldDef[] = [
    withAddress(plain({ key: `${k}/label`, item: "incomeFlow.label", label: "名前", level: nameLevel(card), kind: "text", find, path: ["label"], optional: true }), address(f.id, "incomeFlow.label")),
  ];
  if (kinds.length > 1 || !kinds.some((x) => x.kind === f.kind))
    fields.push(withAddress(plain({ key: `${k}/kind`, item: "incomeFlow.kind", label: "種類", level: "simple", kind: "select", options: (kinds.some((x) => x.kind === f.kind) ? kinds : [...kinds, def]).map((x) => ({ value: x.kind, label: x.label })), find, path: ["kind"], structural: true, after: (_h, t) => fixIncomeRow(t), help: `${def.help !== undefined ? `${def.label}: ${def.help}。` : ""}種類で課税の扱いと表の行の既定が決まります（「詳細」で変えられます）` }), address(f.id, "incomeFlow.kind")));
  fields.push(cadenceField(`${k}/cadence`, "incomeFlow.monthly", find, f.id));
  fields.push(withAddress(yenBox({ key: `${k}/amount`, item: "incomeFlow.amount", label: amountName(c, f.everyYears), level: "simple", basis: c === "monthly" ? "monthly" : "once", find, path: ["amount"], hint: (w) => reexpressedNote(getPath(find(w.request.input.household, w), ["amount"])), help: c === "repeat" ? `${everyAmountHelp(f.everyYears)}。今の値段で入れます（これからの値上がりは、「詳細」の「伸び方」に合わせて計算します）` : "今の値段で入れます（これからの値上がりは、「詳細」の「伸び方」に合わせて計算します）" }), address(f.id, "incomeFlow.amount")));
  fields.push(withAddress(timepointField({ key: `${k}/from`, item: "incomeFlow.from", label: c === "once" ? "受け取る時期" : "始まり", level: "simple", find, path: ["from"], ...selfAge(wh), ...(c === "once" ? { after: (_h: Household, t: Obj) => void (t.to = structuredClone(t.from)) } : {}) }), address(f.id, "incomeFlow.from")));
  if (c === "repeat") fields.push(withAddress(everyField(`${k}/every`, "incomeFlow.everyYears", find, EVERY_HELP), address(f.id, "incomeFlow.everyYears")));
  // 養育費の行は、相手（養育を受ける子）の年齢で終わりを見せ、終わりの既定はその子の20歳（0044 の追記）
  const support = f.kind === "childSupport" && card === "family";
  if (c !== "once")
    fields.push(
      withAddress(
        timepointField({ key: `${k}/to`, item: "incomeFlow.to", label: "終わり", level: "simple", find, path: ["to"], startPath: ["from"], optional: true, nullText: "最後まで", ...(support ? { ...supportAge(wh, f), help: SUPPORT_END_HELP, warn: supportEndWarn(find) } : selfAge(wh)) }),
        address(f.id, "incomeFlow.to"),
      ),
    );
  // 相手は相続・贈与と家族のカードでは簡易にも出す（0044・家族の行は前の配偶者・子が相手。養育費は養育を受ける子）
  const headParty = inherit || card === "family";
  if (support) fields.push(supportPartyField(wh, "in", `${k}/counterparty`, "incomeFlow.counterparty", find, f.id, f.counterparty));
  else if (headParty && incomeHasParty(f)) fields.push(withAddress(plain({ key: `${k}/counterparty`, item: "incomeFlow.counterparty", label: "相手（誰から）", level: "simple", kind: "select", options: counterpartyOptions(wh, card), find, path: ["counterparty"], optional: true, fallback: "" }), address(f.id, "incomeFlow.counterparty")));
  fields.push(badgeField(`${k}/likelihood`, "incomeFlow.likelihood", "見込み", LIKELIHOODS, "likely", find, "likelihood", f.id, inherit ? "「当てにしない」にすると、この相続・贈与を除いて計算します。結果の画面で、入れた場合と比べられます" : "結果の「確実な分だけ」で、「当てにしない」の行を外して見られます", badgeLevel(card)));
  const badge = stagedBadge(f as unknown as Record<string, unknown>, ["stages"], ["exceptions"], amountName(c, f.everyYears));
  const detailNotes = [
    ...(f.taxTreatment !== undefined && f.kind !== "sideJob" ? [`課税: ${TAX_TREATMENTS.find((t) => t.value === f.taxTreatment)?.label ?? ""}`] : []),
    ...(f.growth !== undefined ? ["伸び方"] : []),
    ...(badge !== null ? [badge] : []),
  ];
  const main: GroupDef = {
    key: k,
    title: rowTitle(h, f.label !== undefined && f.label !== "" ? f.label : def.label, f),
    ...(excluded || detailNotes.length > 0
      ? { note: [...(excluded ? ["計算に入れていません（見込みを「当てにしない」にした受け取る相続・贈与）。「詳細」の「基本の計算に入れる」で入れられます"] : []), ...(detailNotes.length > 0 ? [`詳細あり: ${detailNotes.join("・")}`] : [])].join("。") }
      : {}),
    level: "simple",
    fields,
    actions: [
      ...(support ? supportActions(wh, "in", k, f, (hh) => hh.incomeFlows) : []),
      removeAction(`${k}/remove`, "外す", "simple", (hh) => void (hh.incomeFlows = (hh.incomeFlows ?? []).filter((x) => x.id !== f.id))),
    ],
  };
  // 副業は所得の区分（雑所得〔業務〕か事業所得か）を簡易で選ぶ（0086）。ほかの区分を入れた行は、その区分も選択肢に残す
  const sideJob = f.kind === "sideJob";
  if (sideJob) {
    const values = SIDE_JOB_TAX.includes(tax) ? SIDE_JOB_TAX : [...SIDE_JOB_TAX, tax];
    const effect = TAX_TREATMENTS.find((t) => t.value === tax)?.effect ?? "";
    fields.splice(
      fields.length - 1,
      0,
      withAddress(
        plain({
          key: `${k}/tax`,
          item: "incomeFlow.taxTreatment",
          label: "所得の区分",
          level: "simple",
          kind: "select",
          options: values.map((v) => ({ value: v, label: TAX_TREATMENTS.find((t) => t.value === v)?.label ?? v })),
          find,
          path: ["taxTreatment"],
          optional: true,
          fallback: def.tax,
          help: `${SIDE_JOB_TAX_HELP}。${effect}`,
        }),
        address(f.id, "incomeFlow.taxTreatment"),
      ),
    );
  }
  // 詳細1: 課税の扱い（副業の所得の区分は上の簡易の欄）
  const taxFields: FieldDef[] = sideJob
    ? []
    : [
        withAddress(
          plain({
            key: `${k}/tax`,
            item: "incomeFlow.taxTreatment",
            label: "課税の扱い",
            level: "detail",
            kind: "select",
            options: TAX_TREATMENTS.map((t) => ({ value: t.value, label: t.label })),
            find,
            path: ["taxTreatment"],
            optional: true,
            fallback: def.tax,
            help: TAX_TREATMENTS.find((t) => t.value === tax)?.effect ?? "",
          }),
          address(f.id, "incomeFlow.taxTreatment"),
        ),
      ];
  if (tax === "temporary" || tax === "miscBusiness" || tax === "miscOther" || tax === "business" || tax === "capitalGains")
    taxFields.push(withAddress(yenBox({ key: `${k}/cost`, item: "incomeFlow.cost", label: costLabel(tax, c, f.everyYears), level: "detail", basis: c === "monthly" ? "monthly" : "once", find, path: ["cost"], optional: true, help: costHelp(tax, c, f.everyYears) }), address(f.id, "incomeFlow.cost")));
  if (tax === "gift")
    taxFields.push(withAddress(plain({ key: `${k}/giftMethod`, item: "incomeFlow.giftMethod", label: "贈与税の課税の方法", level: "detail", kind: "select", options: [{ value: "calendar", label: "暦年課税" }, { value: "settlement", label: "相続時精算課税" }], find, path: ["giftMethod"], optional: true, fallback: "calendar" }), address(f.id, "incomeFlow.giftMethod")));
  // 詳細2: 受け取る人・相手・伸び方・万一のときの扱い・表の行（受け取る相続・贈与は「基本の計算に入れる」も）
  const whoFields: FieldDef[] = [
    withAddress(plain({ key: `${k}/recipient`, item: "incomeFlow.recipient", label: "受け取る人", level: "detail", kind: "select", options: insiderOptions(wh), find, path: ["recipient"], optional: true, fallback: "", help: "受け取る人を選ぶと、税はその人の所得として計算し、万一のときの扱いもその人に起きたときだけにします（選ばないときの税はご本人の所得で計算します）" }), address(f.id, "incomeFlow.recipient")),
  ];
  const party = !headParty && incomeHasParty(f);
  if (party) whoFields.push(withAddress(plain({ key: `${k}/counterparty`, item: "incomeFlow.counterparty", label: "相手（誰から）", level: "detail", kind: "select", options: counterpartyOptions(wh, card), find, path: ["counterparty"], optional: true, fallback: "", help: "世帯の外の家族から選びます（介護・親の項目で足します）" }), address(f.id, "incomeFlow.counterparty")));
  whoFields.push(...growthFields(k, "incomeFlow.growth", find, f.id, f.growth));
  whoFields.push(...onContingencyFields({ key: `${k}/on`, item: "incomeFlow.onContingency", find, path: ["onContingency"], level: "detail", help: "万一（死亡など）が起きた月の翌月から、この扱いにします。受け取る人を選んだ行は、その人に起きたときだけです" }).map((x) => withAddress(x, address(f.id, "incomeFlow.onContingency"))));
  whoFields.push(...onContingencyDetailFields({ key: `${k}/on`, item: "incomeFlow.onContingency", find, path: ["onContingency"], on: f.onContingency, level: "detail" }).map((x) => withAddress(x, address(f.id, "incomeFlow.onContingency"))));
  whoFields.push(withAddress(plain({ key: `${k}/row`, item: "incomeFlow.row", label: "キャッシュフロー表の行", level: "detail", kind: "select", options: incomeRowChoices(f), find, path: ["row"], optional: true, fallback: incomeRowOf(h, { ...f, row: undefined } as IncomeFlow), ...rowHelp(f.row !== undefined && !incomeRowChoices({ kind: f.kind }).some((o) => o.value === f.row)) }), address(f.id, "incomeFlow.row")));
  if (f.kind === "inheritance" || f.kind === "giftReceived")
    whoFields.push(withAddress(plain({ key: `${k}/includeInBase`, item: "incomeFlow.includeInBase", label: "基本の計算に入れる", level: "detail", kind: "bool", find, path: ["includeInBase"], optional: true, fallback: false, help: "見込みが「当てにしない」でも、見込みはそのままで、この行を計算に入れます。プランを直しているときは、このプランでだけ入れます" }), address(f.id, "incomeFlow.includeInBase")));
  // 「▸ 続きを見る」の文（0078 の追記 2026-11-01）: 開くと出るまとまりの代表（副業は課税の扱いを標準で選ぶので必要経費）
  main.moreLabel = incomeMoreLabel(taxFields.length > 0 ? (sideJob ? "cost" : "tax") : null);
  return [
    main,
    ...(taxFields.length > 0 ? [{ key: `${k}/tax`, title: sideJob ? "必要経費" : "課税の扱い", level: "detail" as const, fields: taxFields, actions: [] }] : []),
    { key: `${k}/who`, title: party ? "受け取る人・相手・伸び方・万一のときの扱い・表の行" : "受け取る人・伸び方・万一のときの扱い・表の行", level: "detail", fields: whoFields, actions: [] },
    // 額の変化（0040。1回だけの行には出さない。前に入れた変化があれば出す）。行の額の近く（見込みの欄の前）に並べる
    ...(c === "once" && (f.stages ?? []).length + (f.exceptions ?? []).length === 0
      ? []
      : stagedGroups(wh, {
          key: k,
          find,
          target: { object: f.id },
          stages: { path: ["stages"], item: "incomeFlow.stages", at: [] },
          exceptions: { path: ["exceptions"], item: "incomeFlow.exceptions", at: [] },
          basis: c === "monthly" ? "monthly" : "once",
          what: amountName(c, f.everyYears),
          base: (hh) => (hh.incomeFlows ?? []).find((x) => x.id === f.id)?.amount.value ?? null,
          ...selfAge(wh),
          flow: "in",
          place: { group: k, before: `${k}/likelihood` },
        })),
  ];
}

/** 入るお金の行を足す（種類のひな形。額は入れない＝未入力の警告。相続・援助の額は外れると大きく誤るため目安を作らない） */
export function addIncome(wh: WorkingHousehold, kind: IncomeFlowKind, id: string = newId()): WorkingHousehold {
  const def = incomeKind(kind);
  const base = wh.request.input.baseMonth;
  const at = addMonths(base, 12);
  return mutate(wh, (h) => {
    const counterparty = def.card === "inherit" || def.card === "care" ? (h.members.find((m) => isOutside(m) && (m.kind === "parent" || m.kind === "grandparent"))?.id ?? h.donors?.[0]?.id) : undefined;
    const f: IncomeFlow = {
      id,
      label: def.label.replace(/（.*）$/, ""),
      kind,
      from: { at },
      to: def.cadence === "once" ? { at } : null,
      everyYears: 1,
      ...(def.cadence === "monthly" ? { monthly: true } : {}),
      amount: standardBox(0, "未入力（額を入れてください。0円で計算中）"),
      ...(counterparty !== undefined ? { counterparty } : {}),
      // 受け取る予定の相続・贈与の見込みは、事務所の既定値（「当てにしない」なら基本の計算に入れない。0073）
      ...(def.card === "inherit" && officeNow().inheritLikelihood === "uncertain" ? { likelihood: "uncertain" as const } : {}),
    };
    (h.incomeFlows ??= []).push(f);
  });
}

// ---- 出るお金の行 ----

/** 出るお金の行のまとまりに足す欄: 種類（そのカードで2つ以上選べるとき）・相手（相続・贈与の区画は簡易）と、札の優先度 */
export function expenseHeadFields(wh: WorkingHousehold, p: PeriodicExpense, card: MoneyCard): FieldDef[] {
  const find = byId(periodic, p.id);
  const k = `ev/${p.id}`;
  const kinds = kindsOf(card).outs;
  const fields: FieldDef[] = [];
  if (kinds.length > 1 && p.kind !== undefined) fields.push(withAddress(plain({ key: `${k}/kind`, item: "periodicExpense.kind", label: "種類", level: "simple", kind: "select", options: kinds.map((x) => ({ value: x.kind, label: x.label })), find, path: ["kind"], after: (_h, t) => fixExpenseRow(t) }), address(p.id, "periodicExpense.kind")));
  if (card === "family" && p.kind === "childSupport") {
    fields.push(supportPartyField(wh, "out", `${k}/counterparty`, "periodicExpense.counterparty", find, p.id, p.counterparty));
    const birth = supportChildBirth(wh, p);
    if (birth !== null) fields.push(birth);
    const dependent = supportDependentField(wh, p);
    if (dependent !== null) fields.push(dependent);
  } else if ((card === "inherit" || card === "family") && expenseHasParty(p)) fields.push(withAddress(plain({ key: `${k}/counterparty`, item: "periodicExpense.counterparty", label: "相手（誰へ）", level: "simple", kind: "select", options: counterpartyOptions(wh, card), find, path: ["counterparty"], optional: true, fallback: "" }), address(p.id, "periodicExpense.counterparty")));
  return fields;
}

/** 出るお金の行の札（優先度）。どのカードでも標準に出す（ライフイベントの行も、行の右で「必ず」「できれば」を選ぶ。0068 の追記 2026-10-31） */
export function expensePriorityField(p: PeriodicExpense): FieldDef {
  return badgeField(`ev/${p.id}/priority`, "periodicExpense.priority", "優先度", PRIORITIES, "need", byId(periodic, p.id), "priority", p.id, "結果の「確実な分だけ」で、「できれば」の行を外して見られます", "simple");
}

/** 出るお金の行の詳細のまとまり（あげる贈与／払う人・相手・伸び方・万一のときの扱い） */
export function expenseDetailGroups(wh: WorkingHousehold, p: PeriodicExpense, card: MoneyCard): GroupDef[] {
  const find = byId(periodic, p.id);
  const k = `ev/${p.id}`;
  const groups: GroupDef[] = [];
  if (p.kind === "gift" || p.gift !== undefined) {
    const gfind: Finder = (h, w) => (getPath(find(h, w), ["gift"]) as Obj | undefined) ?? undefined;
    const ensure = (h: Household, w: WorkingHousehold): Obj => {
      const t = find(h, w) as Obj;
      return ((t.gift ??= {}) as Obj);
    };
    groups.push({
      key: `${k}/gift`,
      title: "あげる贈与",
      note: "贈与税は受け取る人が払うので、世帯からは出さず、結果の要約（贈与の一覧）に出します。受け取る人（相手）の生年月が要ります",
      level: "detail",
      fields: [
        withAddress(plain({ key: `${k}/gift/purpose`, item: "periodicExpense.gift", label: "使い道", level: "detail", kind: "select", options: [{ value: "general", label: "ふつうの贈与" }, { value: "housing", label: "住宅資金（住宅取得等資金の非課税を使う）" }, { value: "asNeeded", label: "生活費・教育費をその都度払う（非課税）" }], find: gfind, ensure, path: ["purpose"], optional: true, fallback: "general" }), address(p.id, "periodicExpense.gift", ["purpose"])),
        withAddress(plain({ key: `${k}/gift/method`, item: "periodicExpense.gift", label: "課税の方法", level: "detail", kind: "select", options: [{ value: "calendar", label: "暦年課税" }, { value: "settlement", label: "相続時精算課税" }], find: gfind, ensure, path: ["method"], optional: true, fallback: "calendar" }), address(p.id, "periodicExpense.gift", ["method"])),
      ],
      actions: [],
    });
  }
  const fields: FieldDef[] = [
    withAddress(plain({ key: `${k}/payer`, item: "periodicExpense.payer", label: "払う人", level: "detail", kind: "select", options: insiderOptions(wh), find, path: ["payer"], optional: true, fallback: "", help: "払う人を選ぶと、万一のときの扱いをその人に起きたときだけにします（お金は世帯で1つの財布として計算します）" }), address(p.id, "periodicExpense.payer")),
  ];
  const party = card !== "inherit" && card !== "family" && expenseHasParty(p);
  if (party) fields.push(withAddress(plain({ key: `${k}/counterparty`, item: "periodicExpense.counterparty", label: "相手（誰へ）", level: "detail", kind: "select", options: counterpartyOptions(wh, card), find, path: ["counterparty"], optional: true, fallback: "" }), address(p.id, "periodicExpense.counterparty")));
  fields.push(...growthFields(k, "periodicExpense.growth", find, p.id, p.growth));
  fields.push(...onContingencyFields({ key: `${k}/on`, item: "periodicExpense.onContingency", find, path: ["onContingency"], level: "detail" }).map((x) => withAddress(x, address(p.id, "periodicExpense.onContingency"))));
  fields.push(...onContingencyDetailFields({ key: `${k}/on`, item: "periodicExpense.onContingency", find, path: ["onContingency"], on: p.onContingency, level: "detail" }).map((x) => withAddress(x, address(p.id, "periodicExpense.onContingency"))));
  groups.push({ key: `${k}/who`, title: party ? "払う人・相手・伸び方・万一のときの扱い" : "払う人・伸び方・万一のときの扱い", level: "detail", fields, actions: [] });
  return groups;
}

/** 出るお金の行を足す（種類のひな形。額は目安のボタンの値＝推定） */
export function addExpense(wh: WorkingHousehold, kind: MoneyOutKind, id: string = newId()): WorkingHousehold {
  const def = outKind(kind);
  const at = addMonths(wh.request.input.baseMonth, 12);
  return mutate(wh, (h) => {
    const counterparty =
      kind === "allowance"
        ? (h.members.find((m) => isOutside(m) && (m.kind === "parent" || m.kind === "grandparent"))?.id ?? h.donors?.[0]?.id)
        : kind === "gift"
          ? h.members.find((m) => isOutside(m) && (m.kind === "grandchild" || m.kind === "child"))?.id
          : undefined;
    const p: PeriodicExpense = {
      id,
      label: def.label.replace(/（.*）$/, ""),
      kind,
      row: def.row,
      from: { at },
      to: def.cadence === "once" ? { at } : null,
      everyYears: def.everyYears ?? 1,
      ...(def.cadence === "monthly" ? { monthly: true } : {}),
      amount: standardBox(def.amount, presetBasis(def.preset)),
      ...(counterparty !== undefined ? { counterparty } : {}),
      ...(kind === "gift" ? { gift: { method: "calendar", purpose: "general" } } : {}),
    };
    (h.periodicExpenses ??= []).push(p);
  });
}

// ---- 出るお金の行のまとまり（周期的な支出。欄のキーは今までの ev/<物>/…） ----

export function periodicGroup(wh: WorkingHousehold, p: PeriodicExpense, card: MoneyCard = expenseCard(wh.request.input.household, p)): GroupDef {
  const find = byId(periodic, p.id);
  const k = `ev/${p.id}`;
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  const ageOf = self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {};
  const h0 = wh.request.input.household;
  // 時期の入れ方（1回・毎月・年ごと。0044）。1回は終わり＝初め・何年ごと1、毎月は monthly
  const c = cadenceOf(h0, p);
  const once = c === "once";
  const fields: FieldDef[] = [
    plain({ key: `${k}/label`, item: "periodicExpense.label", label: "名前", level: nameLevel(card), kind: "text", find, path: ["label"], optional: true }),
    ...expenseHeadFields(wh, p, card),
    cadenceField(`${k}/cadence`, "periodicExpense.monthly", find, p.id, p.kind === "repair" ? { noMonthly: { help: REPAIR_CADENCE_HELP, legacy: REPAIR_MONTHLY_LEGACY, monthlyNow: c === "monthly" } } : {}),
    yenBox({ key: `${k}/amount`, item: "periodicExpense.amount", label: amountName(c, p.everyYears), level: "simple", basis: c === "monthly" ? "monthly" : "once", find, path: ["amount"], hint: (w) => reexpressedNote(getPath(find(w.request.input.household, w), ["amount"])), ...(c === "repeat" ? { help: everyAmountHelp(p.everyYears) } : {}) }),
    timepointField({ key: `${k}/from`, item: "periodicExpense.from", label: once ? "時期" : "初め", level: "simple", find, path: ["from"], ...ageOf, ...(once ? { after: (_h: Household, t: Record<string, unknown>) => void (t.to = structuredClone(t.from)) } : {}) }),
  ];
  if (c === "repeat") fields.push(everyField(`${k}/every`, "periodicExpense.everyYears", find, EVERY_HELP));
  const support = card === "family" && p.kind === "childSupport";
  if (!once) fields.push(timepointField({ key: `${k}/to`, item: "periodicExpense.to", label: "終わり", level: "simple", find, path: ["to"], startPath: ["from"], optional: true, nullText: "最後まで", ...(support ? { ...supportAge(wh, p), help: SUPPORT_END_HELP, warn: supportEndWarn(find) } : ageOf) }));
  fields.push(expensePriorityField(p));
  const legacy = p.row !== undefined && !expenseRowChoices({ kind: p.kind }).some((o) => o.value === p.row);
  fields.push(plain({ key: `${k}/row`, item: "periodicExpense.row", label: "キャッシュフロー表の行", level: "detail", kind: "select", options: expenseRowChoices(p), find, path: ["row"], ...(card === "living" ? { help: `「医療・介護」の行にすると、結果の表で医療費として分けて見られます${legacy ? `。${LEGACY_ROW_HELP}` : ""}` } : rowHelp(legacy)) }));
  const badge = stagedBadge(p as unknown as Record<string, unknown>, ["stages"], ["exceptions"], amountName(c, p.everyYears));
  const name = p.label !== undefined && p.label !== "" ? p.label : unnamedExpense(h0, p);
  const details = [...(p.payer !== undefined ? ["払う人"] : []), ...(p.growth !== undefined ? ["伸び方"] : []), ...(badge !== null ? [badge] : [])];
  return {
    key: k,
    title: rowTitle(h0, name, p),
    ...(details.length > 0 ? { note: `詳細あり: ${details.join("・")}（「詳細」で直せます）` } : {}),
    level: "simple",
    // 「▸ 続きを見る」の文（0078 の追記 2026-11-01）: あげる贈与は使い道と課税の方法、ほかは払う人と伸び方（expenseDetailGroups）
    moreLabel: p.kind === "gift" || p.gift !== undefined ? "使い道・課税の方法を入れる" : "払う人・伸び方を入れる",
    fields,
    actions: [
      ...(support ? supportActions(wh, "out", k, p, (h) => h.periodicExpenses) : []),
      // 古い値の優先度「夢」（wish）の行は「できれば」で見せ、FP が夢プランへ移せる（0103。自動では移さない）
      ...(p.priority === "wish" && p.kind !== "dream" ? [{ key: `${k}/toDream`, label: "夢にする", help: "この行を夢プランの1件にします（名前・額・時期はそのまま）", level: "simple" as const, run: (w: WorkingHousehold) => toDream(w, p.id) }] : []),
      removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.periodicExpenses = (h.periodicExpenses ?? []).filter((x) => x.id !== p.id))),
    ],
  };
}

/** 出るお金の行のまとまりの全部（1行・詳細のまとまり・額の変化） */
export function periodicGroups(wh: WorkingHousehold, p: PeriodicExpense): GroupDef[] {
  const card = expenseCard(wh.request.input.household, p);
  return [periodicGroup(wh, p, card), ...expenseDetailGroups(wh, p, card), ...periodicStageGroups(wh, p)];
}

/** 周期的な支出の額の変化（段階と例外の年。0040。1回だけの支出には出さない）。行の額の近く（優先度の欄の前）に並べる */
export function periodicStageGroups(wh: WorkingHousehold, p: PeriodicExpense): GroupDef[] {
  const h0 = wh.request.input.household;
  const once = p.everyYears === 1 && p.to != null && resolveTimepoint(h0, p.to) !== null && resolveTimepoint(h0, p.to) === resolveTimepoint(h0, p.from);
  if (once && (p.stages ?? []).length + (p.exceptions ?? []).length === 0) return [];
  const c = cadenceOf(h0, p);
  const self = h0.members.find((m) => m.kind === "self");
  return stagedGroups(wh, {
    key: `ev/${p.id}`,
    find: byId(periodic, p.id),
    target: { object: p.id },
    stages: { path: ["stages"], item: "periodicExpense.stages", at: [] },
    exceptions: { path: ["exceptions"], item: "periodicExpense.exceptions", at: [] },
    basis: c === "monthly" ? "monthly" : "once",
    what: amountName(c, p.everyYears),
    base: (h) => (h.periodicExpenses ?? []).find((x) => x.id === p.id)?.amount.value ?? null,
    ...(self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {}),
    flow: "out",
    place: { group: `ev/${p.id}`, before: `ev/${p.id}/priority` },
  });
}

// ---- カードの区画 ----

/**
 * そのカードの「入るお金」「出るお金」の区画。出るお金の行のまとまりは、周期的な支出の欄（events.ts の periodicGroup）に欄を足したもの。
 * claimed は FP が別のカードに足した物（items.ts の addedItems）
 */
export function moneySections(
  wh: WorkingHousehold,
  card: MoneyCard,
  o: { claimed: ReadonlySet<string>; level?: "simple" | "detail"; inTitle?: string; outTitle?: string; note?: string },
): SectionDef[] {
  const h = wh.request.input.household;
  const { incomes: inKinds, outs: outKinds } = kindsOf(card);
  const level = o.level ?? "detail";
  const out: SectionDef[] = [];
  const order = (a: { from: Timepoint }, b: { from: Timepoint }) => (resolveTimepoint(h, a.from) ?? "").localeCompare(resolveTimepoint(h, b.from) ?? "");
  if (inKinds.length > 0) {
    const rows = (h.incomeFlows ?? []).filter((f) => incomeCard(f) === card && !o.claimed.has(f.id)).sort(order);
    out.push({
      key: `money/${card}/in`,
      title: o.inTitle ?? "入るお金",
      ...(rows.length === 0 ? { note: "まだありません" } : {}),
      level,
      groups: rows.flatMap((f) => incomeGroups(wh, f, card)),
      actions: inKinds.map((x): ActionDef => ({ key: `money/${card}/in/add/${x.kind}`, label: `＋ ${x.label}`, ...(x.help !== undefined ? { help: x.help } : {}), level, run: (w) => addIncome(w, x.kind) })),
    });
  }
  if (outKinds.length > 0) {
    const rows = (h.periodicExpenses ?? []).filter((p) => expenseCard(h, p) === card && !o.claimed.has(p.id)).sort(order);
    out.push({
      key: `money/${card}/out`,
      title: o.outTitle ?? "出るお金",
      ...(o.note !== undefined ? { note: o.note } : rows.length === 0 ? { note: "まだありません" } : {}),
      level,
      groups: rows.flatMap((p) => periodicGroups(wh, p)),
      actions: outKinds.map((x): ActionDef => ({ key: `money/${card}/out/add/${x.kind}`, label: `＋ ${x.label}`, ...(x.help !== undefined ? { help: x.help } : {}), level, run: (w) => addExpense(w, x.kind) })),
    });
  }
  return out;
}

/** 相続で受け継ぐ借金（相続・贈与の区画）。返済の欄は住まい・ローンの項目の「住宅ローン以外のローン」で入れる */
export function inheritedDebtGroups(wh: WorkingHousehold): GroupDef[] {
  const h = wh.request.input.household;
  const debts = (h.debts ?? []).filter((d) => d.inheritedFrom !== undefined);
  return debts.map((d) => {
    const find = byId((hh) => hh.debts, d.id);
    const k = `inherit/debt/${d.id}`;
    return {
      key: k,
      title: `相続で受け継ぐ借金（${memberLabel(wh, d.debtors[0]?.member)}）`,
      note: [
        ...(excludedDebt(d) ? ["計算に入れていません（見込みが「当てにしない」）。「基本の計算に入れる」で入れられます"] : []),
        "借入額・金利・返済は住まい・ローンの項目の「住宅ローン以外のローン」で入れます",
      ].join("。"),
      level: "simple",
      fields: [
        withAddress(plain({ key: `${k}/from`, item: "debt.inheritedFrom", label: "元の借り手", level: "simple", kind: "select", options: counterpartyOptions(wh).slice(1), find, path: ["inheritedFrom"] }), address(d.id, "debt.inheritedFrom")),
        withAddress(aliasBadge(plain({ key: `${k}/likelihood`, item: "debt.likelihood", label: "見込み", level: "simple", kind: "select", options: LIKELIHOODS, find, path: ["likelihood"], optional: true, fallback: "likely", help: "「当てにしない」にすると、このお金を除いて計算します。結果の画面で、入れた場合と比べられます" })), address(d.id, "debt.likelihood")),
        withAddress(plain({ key: `${k}/includeInBase`, item: "debt.includeInBase", label: "基本の計算に入れる", help: "見込みが「当てにしない」でも、この行を計算に入れます", level: "detail", kind: "bool", find, path: ["includeInBase"], optional: true, fallback: false }), address(d.id, "debt.includeInBase")),
      ],
      actions: [removeAction(`${k}/remove`, "外す", "simple", (hh) => void (hh.debts = (hh.debts ?? []).filter((x) => x.id !== d.id)))],
    };
  });
}

/** 相続で受け継ぐ借金を足す（ほかのローン。残高は計算の基準の月の1年後から返す、の仮の値） */
export function addInheritedDebt(wh: WorkingHousehold, id: string = newId()): WorkingHousehold {
  const at = addMonths(wh.request.input.baseMonth, 12);
  return mutate(wh, (h) => {
    const self = h.members.find((m) => m.kind === "self");
    const from = h.members.find((m) => isOutside(m) && (m.kind === "parent" || m.kind === "grandparent"))?.id ?? h.donors?.[0]?.id;
    if (self === undefined || from === undefined) return;
    const d: Debt = {
      id,
      kind: "other",
      debtors: [{ member: self.id, role: "primary" }],
      principal: presetNum("preset.loan.inherited.principal"),
      start: { at },
      rateSchedule: [{ from: { at }, type: "fixed", rate: presetRate("preset.loan.inherited.rate") }],
      repayment: { method: "equalPayment", termMonths: presetNum("preset.loan.inherited.termYears") * 12 },
      inheritedFrom: from,
      ...(officeNow().inheritLikelihood === "uncertain" ? { likelihood: "uncertain" as const } : {}),
    };
    (h.debts ??= []).push(d);
  });
}

/** 世帯の外の孫を足す（あげる贈与の相手。生年月は仮の値） */
export function addOutsideGrandchild(wh: WorkingHousehold, id: string = newId()): WorkingHousehold {
  const base = wh.request.input.baseMonth;
  const next = mutate(wh, (h) => {
    const self = h.members.find((m) => m.kind === "self");
    if (self === undefined) return;
    const year = Math.min(Number(base.slice(0, 4)), Number(self.birth.birthYearMonth.slice(0, 4)) + 60);
    h.members.push({ id, kind: "grandchild", birth: { birthYearMonth: `${year}-04`, bornOnFirst: false }, sex: "female", joins: null, leaves: null, expected: false, outside: { of: self.id, periods: [] } } as Member);
  });
  return { ...next, assumed: { ...next.assumed, [`family/${id}/birth`]: "仮の値" } };
}
