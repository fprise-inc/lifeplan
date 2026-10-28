// お金の行（0044）の欄: 出るお金の行（周期的な支出 periodicExpenses）と入るお金の行（incomeFlows）を、どのカードでも同じ形で入れる。
// - 1行のまとまり（簡易）: 名前・種類（そのカードで選べる種類が2つ以上のとき）・時期（1回／毎月／毎年・n年ごと）・額・始まり・何年ごと・終わり・
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
  { kind: "sideJob", label: "副業・雑所得", tax: "miscBusiness", once: "cf.income.other.sideJob", repeat: "cf.income.other.sideJob", card: "work", cadence: "repeat" },
  { kind: "otherWork", label: "その他の働く収入", help: "給与として本業と合わせて税を計算し、社会保険料はかけません", tax: "salary", once: "cf.income.salary", repeat: "cf.income.salary", card: "work", cadence: "repeat" },
  { kind: "saleBusiness", label: "売却代金（事業・出資持分）", tax: "capitalGains", once: "cf.income.lumpSum.other", repeat: "cf.income.lumpSum.other", card: "work", cadence: "once" },
  { kind: "saleGoods", label: "動産の売却（車以外）", tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.lumpSum.other", card: "events", cadence: "once" },
  { kind: "temporary", label: "一時所得", help: "懸賞・保険以外の満期の一時金などです", tax: "temporary", once: "cf.income.lumpSum.other", repeat: "cf.income.other", card: "events", cadence: "once" },
  { kind: "celebration", label: "祝い金・お見舞い・一時の給付金", tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.lumpSum.other", card: "events", cadence: "once" },
  { kind: "subsidy", label: "住まいの補助金・移住の支援金", tax: "temporary", once: "cf.income.lumpSum.other", repeat: "cf.income.other", card: "housing", cadence: "once" },
  { kind: "powerSale", label: "売電の収入", tax: "miscOther", once: "cf.income.other", repeat: "cf.income.other", card: "housing", cadence: "repeat" },
  { kind: "insuranceBenefit", label: "計算の型に無い保険の給付の見込み", tax: "nonTaxable", once: "cf.income.other.insuranceBenefit", repeat: "cf.income.other.insuranceBenefit", card: "insurance", cadence: "once" },
  { kind: "other", label: "その他の入金", tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.other", card: "events", cadence: "once" },
];

/** 出るお金の種類: 名前・表の行の既定・置くカード・足すときのひな形（額・時期。推定） */
export const OUT_KINDS: readonly { kind: MoneyOutKind; label: string; help?: string; row: string; card: MoneyCard; cadence: Cadence; amount: number; everyYears?: number; preset: string }[] = [
  { kind: "general", label: "一時的支出・n年ごとの支出", row: "cf.expense.lumpSum.other", card: "events", cadence: "once", amount: 500000, preset: "一時的支出 50万円" },
  { kind: "childSupport", label: "養育費を払う", row: "cf.expense.other", card: "family", cadence: "monthly", amount: 40000, preset: "養育費 月4万円" },
  { kind: "allowance", label: "仕送り", row: "cf.expense.other", card: "care", cadence: "monthly", amount: 30000, preset: "仕送り 月3万円" },
  { kind: "gift", label: "あげる贈与", help: "孫などへの贈与です", row: "cf.expense.lumpSum.gift", card: "inherit", cadence: "once", amount: 1100000, preset: "贈与 110万円" },
  { kind: "education", label: "留学・寮費・部活などの教育費", row: "cf.expense.education", card: "education", cadence: "repeat", amount: 100000, everyYears: 1, preset: "その他の教育費 年10万円" },
  { kind: "repair", label: "修繕・リフォーム", row: "cf.expense.housing.maintenance", card: "housing", cadence: "repeat", amount: 1000000, everyYears: 10, preset: "修繕 10年ごとに100万円" },
  { kind: "realEstateCost", label: "不動産の一時の経費", help: "大規模修繕・原状回復などの一時の経費です", row: "cf.expense.other", card: "rental", cadence: "once", amount: 1000000, preset: "不動産の一時の経費 100万円" },
  { kind: "livingAnnual", label: "年払い・数年おきの暮らしの支出", row: "cf.expense.living", card: "living", cadence: "repeat", amount: 100000, everyYears: 1, preset: "年払いの支出 年10万円" },
  { kind: "car", label: "車の修理・用品など", row: "cf.expense.living.car", card: "car", cadence: "repeat", amount: 50000, everyYears: 1, preset: "車の用品など 年5万円" },
  { kind: "other", label: "その他の支出", row: "cf.expense.other", card: "events", cadence: "once", amount: 100000, preset: "その他の支出 10万円" },
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

/** 基本生活費のカードの出るお金の行（年払い・数年おきの暮らしの支出）が選べる表の行 */
export const LIVING_OUT_ROWS: Option[] = OUT_ROWS.filter((o) => o.value === "cf.expense.living" || o.value === "cf.expense.care.medical" || o.value === "cf.expense.other");

/** 医療費の窓口負担の説明（自動では変えない。段階で額を変える） */
export const MEDICAL_HELP = "医療費の窓口負担は、70〜74歳は2割、75歳以上は1割（所得によって2〜3割）に下がります。計算では自動で変えないので、額を変えるときは段階で入れてください";

/** 入るお金の行が選べる表の行（エンジンの incomeFlow.row） */
export const IN_ROWS: Option[] = [
  "cf.income.lumpSum.other",
  "cf.income.lumpSum.gift",
  "cf.income.lumpSum.inheritance",
  "cf.income.other",
  "cf.income.other.sideJob",
  "cf.income.other.insuranceBenefit",
  "cf.income.salary",
  "cf.income.business",
  "cf.income.pension",
  "cf.income.benefit",
  "cf.income.benefit.unemployment",
  "cf.income.benefit.education",
].map((value) => ({ value, label: ROW_LABELS[value] ?? value }));

/** 課税の扱い（9通り）と、結果への効き方の一文 */
export const TAX_TREATMENTS: readonly { value: IncomeTaxTreatment; label: string; effect: string }[] = [
  { value: "nonTaxable", label: "非課税", effect: "所得税・住民税はかかりません" },
  { value: "temporary", label: "一時所得", effect: "必要経費を引き、ほかの一時所得と合わせて特別控除（50万円まで）を引いた2分の1を、受け取る人の所得に足します" },
  { value: "miscBusiness", label: "雑所得（業務）", effect: "収入から必要経費を引いた額を、受け取る人の所得に足します" },
  { value: "miscOther", label: "雑所得（その他）", effect: "収入から必要経費を引いた額を、受け取る人の所得に足します" },
  { value: "salary", label: "給与（社会保険なし）", effect: "本業の給与と合わせて給与所得にします。社会保険料はかけません" },
  { value: "business", label: "事業所得", effect: "収入から必要経費を引いた額を、受け取る人の事業所得に足します" },
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

/** 時期の入れ方: 1回／毎月（月額）／毎年・n年ごと */
export type Cadence = "once" | "monthly" | "repeat";
const CADENCES: Option[] = [
  { value: "once", label: "1回" },
  { value: "monthly", label: "毎月（月額）" },
  { value: "repeat", label: "毎年・n年ごと" },
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
    outs: OUT_KINDS.filter((k) => k.card === card || (card === "family" && k.kind === "allowance")),
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
          ? "養育を受ける子を選びます。終わりの既定はその子が20歳になる月です。いない子は「＋ 離れて暮らす子を足す」で足せます（介護・親のカードの「世帯の外の家族」に入ります）。受け取る人（前の配偶者）は計算に効かないので、名前の欄に書いておけます"
          : "養育を受ける子を選びます。終わりの既定はその子が20歳になる月です。払う人（前の配偶者）は計算に効かないので、名前の欄に書いておけます",
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
    help: "終わり（20歳になる月など）はこの生年月で決まります。介護・親のカードの「世帯の外の家族」と同じ欄です",
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

/** 時期の入れ方の欄（1回／毎月／毎年・n年ごと）。1回は終わりを始まりと同じ月に、毎月は monthly を立てる（何年ごとは1） */
export function cadenceField(key: string, item: string, find: Finder, id: string): FieldDef {
  return withAddress(
    field({
      key,
      item,
      label: "時期",
      level: "simple",
      kind: "select",
      options: CADENCES,
      structural: true,
      get: (wh) => {
        const r = find(wh.request.input.household, wh) as unknown as PeriodicExpense | undefined;
        return { value: r === undefined ? null : cadenceOf(wh.request.input.household, r) };
      },
      set: (wh, v) =>
        mutate(wh, (h) => {
          const r = find(h, wh) as unknown as (PeriodicExpense & Obj) | undefined;
          if (r === undefined) return;
          const was = cadenceOf(h, r);
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
        }),
    }),
    address(id, item),
  );
}

/**
 * 札（見込み・優先度）の欄。ライフイベントのカードの行では詳細（今の結果には効かず、「確実な分だけ」の見方でだけ効く。既定の必ず・確実のままで
 * 結果は同じ。0078）。ほかのカード（受け取る相続の見込みは基本の計算に入れるかが決まる）は標準
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
  const out = [withAddress(plain({ key: `${key}/growth`, item, label: "伸び方", level: "detail", kind: "select", options: GROWTH_KINDS, find, path: ["growth", "kind"], fallback: "inflation", optional: true, structural: true, after: (_h, t, v) => fixGrowth(t, v), help: "額は今の値段（計算の基準の年の価格）で入れます。既定は前提条件の物価上昇率で伸ばします" }), address(id, item, ["kind"]))];
  if (cur?.kind === "rate") out.push(withAddress(plain({ key: `${key}/growthRate`, item, label: "決まった変動率（年）", help: "マイナスも入れられます", level: "detail", kind: "pct", find, path: ["growth", "rate"] }), address(id, item, ["rate"])));
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

/** 閉じた行の見出し: 「入｜父からの相続 2,000万円・1回 2041年7月」 */
export function rowTitle(h: Household, dir: "入" | "出", name: string, r: RowShape): string {
  const p = rowParts(h, r);
  return `${dir}｜${name} ${p.amount} ${p.when}`;
}

/** 入るお金の行の名前（名前が空なら種類の名前） */
export const incomeName = (f: IncomeFlow): string => (f.label !== undefined && f.label !== "" ? f.label : incomeKind(f.kind).label);

/** 出るお金の行の名前（名前が空なら種類の名前。種類の無い行は時期で「一時的支出」「n年ごとの支出」） */
export function expenseName(h: Household, p: PeriodicExpense): string {
  if (p.label !== undefined && p.label !== "") return p.label;
  if (p.kind !== undefined && p.kind !== "general") return outKind(p.kind).label;
  return cadenceOf(h, p) === "once" ? "一時的支出" : "n年ごとの支出";
}

/** 受け継ぐ借金の額と時期の文字（残高か借入額、借り始め） */
export function debtParts(h: Household, d: Debt): { amount: string; when: string } {
  const from = ymText(resolveTimepoint(h, d.start));
  return { amount: yenText(d.balance?.value ?? d.principal), when: from === "" ? "" : `${from}から` };
}

// ---- 入るお金の行 ----

/** 入るお金の行のまとまり（簡易の1行・詳細の3まとまり） */
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
    fields.push(withAddress(plain({ key: `${k}/kind`, item: "incomeFlow.kind", label: "種類", level: "simple", kind: "select", options: (kinds.some((x) => x.kind === f.kind) ? kinds : [...kinds, def]).map((x) => ({ value: x.kind, label: x.label })), find, path: ["kind"], structural: true, help: `${def.help !== undefined ? `${def.label}: ${def.help}。` : ""}種類で課税の扱いと表の行の既定が決まります（詳細で変えられます）` }), address(f.id, "incomeFlow.kind")));
  fields.push(cadenceField(`${k}/cadence`, "incomeFlow.monthly", find, f.id));
  fields.push(withAddress(yenBox({ key: `${k}/amount`, item: "incomeFlow.amount", label: c === "monthly" ? "月額" : c === "once" ? "額" : "1回の額（毎年なら年額）", level: "simple", basis: c === "monthly" ? "monthly" : "once", find, path: ["amount"], help: "今の値段（計算の基準の年の価格）で入れます" }), address(f.id, "incomeFlow.amount")));
  fields.push(withAddress(timepointField({ key: `${k}/from`, item: "incomeFlow.from", label: c === "once" ? "受け取る時期" : "始まり", level: "simple", find, path: ["from"], ...selfAge(wh), ...(c === "once" ? { after: (_h: Household, t: Obj) => void (t.to = structuredClone(t.from)) } : {}) }), address(f.id, "incomeFlow.from")));
  if (c === "repeat") fields.push(withAddress(plain({ key: `${k}/every`, item: "incomeFlow.everyYears", label: "何年ごと", level: "simple", kind: "int", suffix: "年ごと", min: 1, max: 50, find, path: ["everyYears"] }), address(f.id, "incomeFlow.everyYears")));
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
  else if (headParty) fields.push(withAddress(plain({ key: `${k}/counterparty`, item: "incomeFlow.counterparty", label: "相手（誰から）", level: "simple", kind: "select", options: counterpartyOptions(wh, card), find, path: ["counterparty"], optional: true, fallback: "" }), address(f.id, "incomeFlow.counterparty")));
  fields.push(badgeField(`${k}/likelihood`, "incomeFlow.likelihood", "見込み", LIKELIHOODS, "likely", find, "likelihood", f.id, inherit ? "「当てにしない」の受け取る相続・贈与は、基本の計算に入れません（行は残ります）。結果の「外している物」から入れて見られます" : "結果の「確実な分だけ」で、「当てにしない」の行を外して見られます", badgeLevel(card)));
  const badge = stagedBadge(f as unknown as Record<string, unknown>, ["stages"], ["exceptions"]);
  const detailNotes = [
    ...(f.taxTreatment !== undefined ? [`課税: ${TAX_TREATMENTS.find((t) => t.value === f.taxTreatment)?.label ?? ""}`] : []),
    ...(f.growth !== undefined ? ["伸び方"] : []),
    ...(badge !== null ? [badge] : []),
  ];
  const main: GroupDef = {
    key: k,
    title: rowTitle(h, "入", f.label !== undefined && f.label !== "" ? f.label : def.label, f),
    ...(excluded || detailNotes.length > 0
      ? { note: [...(excluded ? ["計算に入れていません（見込みを「当てにしない」にした受け取る相続・贈与）。詳細の「基本の計算に入れる」で入れられます"] : []), ...(detailNotes.length > 0 ? [`詳細あり: ${detailNotes.join("・")}`] : [])].join("。") }
      : {}),
    level: "simple",
    fields,
    actions: [
      ...(support ? supportActions(wh, "in", k, f, (hh) => hh.incomeFlows) : []),
      removeAction(`${k}/remove`, "外す", "simple", (hh) => void (hh.incomeFlows = (hh.incomeFlows ?? []).filter((x) => x.id !== f.id))),
    ],
  };
  // 詳細1: 課税の扱い
  const taxFields: FieldDef[] = [
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
    taxFields.push(withAddress(yenBox({ key: `${k}/cost`, item: "incomeFlow.cost", label: tax === "capitalGains" ? "取得費・譲渡の費用（1回の額と同じ基準）" : "必要経費（1回の額と同じ基準）", level: "detail", basis: c === "monthly" ? "monthly" : "once", find, path: ["cost"], optional: true }), address(f.id, "incomeFlow.cost")));
  if (tax === "gift")
    taxFields.push(withAddress(plain({ key: `${k}/giftMethod`, item: "incomeFlow.giftMethod", label: "贈与税の課税の方法", level: "detail", kind: "select", options: [{ value: "calendar", label: "暦年課税" }, { value: "settlement", label: "相続時精算課税" }], find, path: ["giftMethod"], optional: true, fallback: "calendar" }), address(f.id, "incomeFlow.giftMethod")));
  // 詳細2: 受け取る人・相手・伸び方・万一のときの扱い・表の行（受け取る相続・贈与は「基本の計算に入れる」も）
  const whoFields: FieldDef[] = [
    withAddress(plain({ key: `${k}/recipient`, item: "incomeFlow.recipient", label: "受け取る人", level: "detail", kind: "select", options: insiderOptions(wh), find, path: ["recipient"], optional: true, fallback: "", help: "構成員を選ぶと、課税の扱いのある行の税はその人の所得に、万一のときの扱いはその人の万一に当てます（世帯のときの税は本人）" }), address(f.id, "incomeFlow.recipient")),
  ];
  if (!headParty) whoFields.push(withAddress(plain({ key: `${k}/counterparty`, item: "incomeFlow.counterparty", label: "相手（誰から）", level: "detail", kind: "select", options: counterpartyOptions(wh, card), find, path: ["counterparty"], optional: true, fallback: "", help: "世帯の外の家族から選びます（介護・親の項目で足します）" }), address(f.id, "incomeFlow.counterparty")));
  whoFields.push(...growthFields(k, "incomeFlow.growth", find, f.id, f.growth));
  whoFields.push(...onContingencyFields({ key: `${k}/on`, item: "incomeFlow.onContingency", find, path: ["onContingency"], level: "detail", help: "万一（死亡など）が起きた月の翌月から当てます。受け取る人を選んだ行は、その人の万一だけに当てます" }).map((x) => withAddress(x, address(f.id, "incomeFlow.onContingency"))));
  whoFields.push(...onContingencyDetailFields({ key: `${k}/on`, item: "incomeFlow.onContingency", find, path: ["onContingency"], on: f.onContingency, level: "detail" }).map((x) => withAddress(x, address(f.id, "incomeFlow.onContingency"))));
  whoFields.push(withAddress(plain({ key: `${k}/row`, item: "incomeFlow.row", label: "キャッシュフロー表の行", level: "detail", kind: "select", options: IN_ROWS, find, path: ["row"], optional: true, fallback: incomeRowOf(h, { ...f, row: undefined } as IncomeFlow) }), address(f.id, "incomeFlow.row")));
  if (f.kind === "inheritance" || f.kind === "giftReceived")
    whoFields.push(withAddress(plain({ key: `${k}/includeInBase`, item: "incomeFlow.includeInBase", label: "基本の計算に入れる", level: "detail", kind: "bool", find, path: ["includeInBase"], optional: true, fallback: false, help: "見込みが「当てにしない」でも、見込みはそのままで、この行を計算に入れます。プランを直しているときは、このプランでだけ入れます" }), address(f.id, "incomeFlow.includeInBase")));
  return [
    main,
    { key: `${k}/tax`, title: "課税の扱い", level: "detail", fields: taxFields, actions: [] },
    { key: `${k}/who`, title: "受け取る人・相手・伸び方・万一のときの扱い・表の行", level: "detail", fields: whoFields, actions: [] },
    ...stagedGroups(wh, {
      key: k,
      find,
      target: { object: f.id },
      stages: { path: ["stages"], item: "incomeFlow.stages", at: [] },
      exceptions: { path: ["exceptions"], item: "incomeFlow.exceptions", at: [] },
      basis: c === "monthly" ? "monthly" : "once",
      what: c === "monthly" ? "月額" : "1回の額",
      base: (hh) => (hh.incomeFlows ?? []).find((x) => x.id === f.id)?.amount.value ?? null,
      ...selfAge(wh),
    }),
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
  if (kinds.length > 1 && p.kind !== undefined) fields.push(withAddress(plain({ key: `${k}/kind`, item: "periodicExpense.kind", label: "種類", level: "simple", kind: "select", options: kinds.map((x) => ({ value: x.kind, label: x.label })), find, path: ["kind"] }), address(p.id, "periodicExpense.kind")));
  if (card === "family" && p.kind === "childSupport") {
    fields.push(supportPartyField(wh, "out", `${k}/counterparty`, "periodicExpense.counterparty", find, p.id, p.counterparty));
    const birth = supportChildBirth(wh, p);
    if (birth !== null) fields.push(birth);
    const dependent = supportDependentField(wh, p);
    if (dependent !== null) fields.push(dependent);
  } else if (card === "inherit" || card === "family") fields.push(withAddress(plain({ key: `${k}/counterparty`, item: "periodicExpense.counterparty", label: "相手（誰へ）", level: "simple", kind: "select", options: counterpartyOptions(wh, card), find, path: ["counterparty"], optional: true, fallback: "" }), address(p.id, "periodicExpense.counterparty")));
  return fields;
}

/** 出るお金の行の札（優先度） */
export function expensePriorityField(p: PeriodicExpense, card: MoneyCard): FieldDef {
  return badgeField(`ev/${p.id}/priority`, "periodicExpense.priority", "優先度", PRIORITIES, "need", byId(periodic, p.id), "priority", p.id, "結果の「確実な分だけ」で、「できれば」の行を外して見られます", badgeLevel(card));
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
    withAddress(plain({ key: `${k}/payer`, item: "periodicExpense.payer", label: "払う人", level: "detail", kind: "select", options: insiderOptions(wh), find, path: ["payer"], optional: true, fallback: "", help: "構成員を選ぶと、万一のときの扱いはその人の万一だけに当てます（夫婦で別の財布は持ちません）" }), address(p.id, "periodicExpense.payer")),
  ];
  if (card !== "inherit" && card !== "family") fields.push(withAddress(plain({ key: `${k}/counterparty`, item: "periodicExpense.counterparty", label: "相手（誰へ）", level: "detail", kind: "select", options: counterpartyOptions(wh, card), find, path: ["counterparty"], optional: true, fallback: "" }), address(p.id, "periodicExpense.counterparty")));
  fields.push(...growthFields(k, "periodicExpense.growth", find, p.id, p.growth));
  fields.push(...onContingencyFields({ key: `${k}/on`, item: "periodicExpense.onContingency", find, path: ["onContingency"], level: "detail" }).map((x) => withAddress(x, address(p.id, "periodicExpense.onContingency"))));
  fields.push(...onContingencyDetailFields({ key: `${k}/on`, item: "periodicExpense.onContingency", find, path: ["onContingency"], on: p.onContingency, level: "detail" }).map((x) => withAddress(x, address(p.id, "periodicExpense.onContingency"))));
  groups.push({ key: `${k}/who`, title: "払う人・相手・伸び方・万一のときの扱い", level: "detail", fields, actions: [] });
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
  // 時期の入れ方（1回・毎月・毎年／n年ごと。0044）。1回は終わり＝初め・何年ごと1、毎月は monthly
  const c = cadenceOf(h0, p);
  const once = c === "once";
  const fields: FieldDef[] = [
    plain({ key: `${k}/label`, item: "periodicExpense.label", label: "名前", level: nameLevel(card), kind: "text", find, path: ["label"], optional: true }),
    ...expenseHeadFields(wh, p, card),
    cadenceField(`${k}/cadence`, "periodicExpense.monthly", find, p.id),
    yenBox({ key: `${k}/amount`, item: "periodicExpense.amount", label: c === "monthly" ? "月額" : once ? "額" : "1回の額", level: "simple", basis: c === "monthly" ? "monthly" : "once", find, path: ["amount"] }),
    timepointField({ key: `${k}/from`, item: "periodicExpense.from", label: once ? "時期" : "初め", level: "simple", find, path: ["from"], ...ageOf, ...(once ? { after: (_h: Household, t: Record<string, unknown>) => void (t.to = structuredClone(t.from)) } : {}) }),
  ];
  if (c === "repeat") fields.push(plain({ key: `${k}/every`, item: "periodicExpense.everyYears", label: "何年ごと", level: "simple", kind: "int", suffix: "年ごと", min: 1, max: 50, find, path: ["everyYears"], help: "1は毎年です" }));
  const support = card === "family" && p.kind === "childSupport";
  if (!once) fields.push(timepointField({ key: `${k}/to`, item: "periodicExpense.to", label: "終わり", level: "simple", find, path: ["to"], startPath: ["from"], optional: true, nullText: "最後まで", ...(support ? { ...supportAge(wh, p), help: SUPPORT_END_HELP, warn: supportEndWarn(find) } : ageOf) }));
  fields.push(expensePriorityField(p, card));
  const rows = card === "living" ? (LIVING_OUT_ROWS.some((o) => o.value === p.row) ? LIVING_OUT_ROWS : [...LIVING_OUT_ROWS, ...OUT_ROWS.filter((o) => o.value === p.row)]) : OUT_ROWS;
  fields.push(plain({ key: `${k}/row`, item: "periodicExpense.row", label: "キャッシュフロー表の行", level: "detail", kind: "select", options: rows, find, path: ["row"], ...(card === "living" ? { help: `「医療・介護」の行にすると、結果の表で医療費として分けて見られます。${MEDICAL_HELP}` } : {}) }));
  const badge = stagedBadge(p as unknown as Record<string, unknown>, ["stages"], ["exceptions"]);
  const name = p.label !== undefined && p.label !== "" ? p.label : once ? "一時的支出" : "n年ごとの支出";
  const details = [...(p.payer !== undefined ? ["払う人"] : []), ...(p.growth !== undefined ? ["伸び方"] : []), ...(badge !== null ? [`1回の額の${badge}`] : [])];
  return {
    key: k,
    title: rowTitle(h0, "出", name, p),
    ...(details.length > 0 ? { note: `詳細あり: ${details.join("・")}（詳細で直せます）` } : {}),
    level: "simple",
    fields,
    actions: [
      ...(support ? supportActions(wh, "out", k, p, (h) => h.periodicExpenses) : []),
      removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.periodicExpenses = (h.periodicExpenses ?? []).filter((x) => x.id !== p.id))),
    ],
  };
}

/** 出るお金の行のまとまりの全部（1行・詳細のまとまり・段階と例外の年） */
export function periodicGroups(wh: WorkingHousehold, p: PeriodicExpense): GroupDef[] {
  const card = expenseCard(wh.request.input.household, p);
  return [periodicGroup(wh, p, card), ...expenseDetailGroups(wh, p, card), ...periodicStageGroups(wh, p)];
}

/** 周期的な支出の1回の額の段階と例外の年（0040。1回だけの支出には出さない） */
export function periodicStageGroups(wh: WorkingHousehold, p: PeriodicExpense): GroupDef[] {
  const h0 = wh.request.input.household;
  const once = p.everyYears === 1 && p.to != null && resolveTimepoint(h0, p.to) !== null && resolveTimepoint(h0, p.to) === resolveTimepoint(h0, p.from);
  if (once && (p.stages ?? []).length + (p.exceptions ?? []).length === 0) return [];
  const self = h0.members.find((m) => m.kind === "self");
  return stagedGroups(wh, {
    key: `ev/${p.id}`,
    find: byId(periodic, p.id),
    target: { object: p.id },
    stages: { path: ["stages"], item: "periodicExpense.stages", at: [] },
    exceptions: { path: ["exceptions"], item: "periodicExpense.exceptions", at: [] },
    basis: "once",
    what: "1回の額",
    base: (h) => (h.periodicExpenses ?? []).find((x) => x.id === p.id)?.amount.value ?? null,
    ...(self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {}),
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
      title: `出｜相続で受け継ぐ借金（${memberLabel(wh, d.debtors[0]?.member)}）`,
      note: [
        ...(excludedDebt(d) ? ["計算に入れていません（見込みが「当てにしない」）。「基本の計算に入れる」で入れられます"] : []),
        "借入額・金利・返済は住まい・ローンの項目の「住宅ローン以外のローン」で入れます",
      ].join("。"),
      level: "simple",
      fields: [
        withAddress(plain({ key: `${k}/from`, item: "debt.inheritedFrom", label: "元の借り手", level: "simple", kind: "select", options: counterpartyOptions(wh).slice(1), find, path: ["inheritedFrom"] }), address(d.id, "debt.inheritedFrom")),
        withAddress(aliasBadge(plain({ key: `${k}/likelihood`, item: "debt.likelihood", label: "見込み", level: "simple", kind: "select", options: LIKELIHOODS, find, path: ["likelihood"], optional: true, fallback: "likely", help: "「当てにしない」なら、基本の計算に入れません（行は残ります）。結果の「外している物」から入れて見られます" })), address(d.id, "debt.likelihood")),
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
      principal: 1000000,
      start: { at },
      rateSchedule: [{ from: { at }, type: "fixed", rate: "0.02" }],
      repayment: { method: "equalPayment", termMonths: 60 },
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
