// 会社と合わせたバランスシート（合算BS）の部品（法人の顧問向けの機能。事務所の設定で FP が使うと決めたときだけ使う。0108）。
// アプリの「資産と負債」のタブ（見るものの差し込み口 customViews。0027 の8）と、提案書の任意の章で同じ部品を使う。
// - 入力は、会社の今のバランスシート（試算表の主な科目）と毎月の固定の支出・返済。家計の側は、今の年の家計のバランスシート（bsGroups.ts の BsAt）
// - 3つの段: ①2枚を並べる ②経営者と会社の間の4つの組を相殺する ③科目ごとに足して1枚にする（純資産は「会社の財産（剰余金）」と「個人の財産」）
// - 組の両側の額が合わないときは、会社の側の額に合わせて見る（経営者の側の書き漏れとして直す考え方）。お知らせの文を作る
// - 指標: 総合（合算）・個人・会社のそれぞれで、現預金 ÷ 毎月の固定の支出（何か月分）。目安は6か月分（できれば12か月分）
// - 会社の段階を選ぶと、どちらの口座にお金を厚くするかの目安の1文
// - 実力に直す点検の一覧: FP が直した額を入れる。計算では直さない（直した額を使うかは FP が選ぶ）
// - 会社の先の年の見込みは作らない。計算エンジンは使わない（足し算と引き算だけ。円の整数のまま）
// 後でカスタム層（0016）の計算部品に移せるよう、入力（世帯ファイルの companyBs）と家計の BS だけから値を作る、副作用のない関数にしている
import type { BsAt, BsGroup, BsLine, Yen } from "./bsGroups.ts";

/** 会社の資産の科目（上から。現預金だけが「すぐ使えるお金」、ほかは「換金しにくい資産」の箱） */
export const COMPANY_ASSETS = [
  { key: "cash", label: "現預金" },
  { key: "receivables", label: "売上債権" },
  { key: "inventory", label: "在庫" },
  { key: "otherCurrent", label: "その他の流動資産" },
  { key: "land", label: "土地" },
  { key: "buildings", label: "建物など" },
  { key: "investments", label: "投資など" },
  { key: "otherFixed", label: "その他の固定資産" },
  { key: "loanToOwner", label: "経営者への貸付金" },
  { key: "advanceToOwner", label: "経営者への立替金" },
] as const;

/** 会社の負債の科目 */
export const COMPANY_LIABILITIES = [
  { key: "shortDebt", label: "短期借入金" },
  { key: "longDebt", label: "長期借入金" },
  { key: "loanFromOwner", label: "経営者からの借入金" },
  { key: "otherLiabilities", label: "その他の負債" },
] as const;

/** 会社の純資産の科目（剰余金はマイナスもある） */
export const COMPANY_EQUITY = [
  { key: "capital", label: "資本金" },
  { key: "otherCapital", label: "資本金のうち、ほかの株主の分" },
  { key: "retained", label: "剰余金（利益の積み上げ）" },
] as const;

/** 毎月の固定の支出（会社） */
export const COMPANY_MONTHLY = [
  { key: "monthlyFixed", label: "毎月の固定費（経費。仕入は含めない）" },
  { key: "monthlyLoanPay", label: "毎月の借入の返済" },
] as const;

export type CompanyAssetKey = (typeof COMPANY_ASSETS)[number]["key"];
export type CompanyLiabilityKey = (typeof COMPANY_LIABILITIES)[number]["key"];
export type CompanyEquityKey = (typeof COMPANY_EQUITY)[number]["key"];
export type CompanyMonthlyKey = (typeof COMPANY_MONTHLY)[number]["key"];
export type CompanyKey = CompanyAssetKey | CompanyLiabilityKey | CompanyEquityKey | CompanyMonthlyKey;

export const COMPANY_KEYS: readonly CompanyKey[] = [...COMPANY_ASSETS, ...COMPANY_LIABILITIES, ...COMPANY_EQUITY, ...COMPANY_MONTHLY].map((x) => x.key);

/** 会社の成長の段階 */
export const COMPANY_STAGES = [
  { key: "founding", label: "創業期", text: "まず合算した現預金を厚くし、次に会社、その次に個人の順に備えるのがひとつの考え方です。会社の資金が足りないときも、個人のお金をすぐに入れる前に、ほかの手立てを一緒に確かめましょう。" },
  { key: "rapid", label: "急成長期", text: "事業の伸びに備えて、会社の現預金を優先するのがひとつの考え方です。合算の現預金が目安を超える状態が続くようなら、役員報酬の見直しなどで個人の側を厚くすることも考えられます。" },
  { key: "unstable", label: "不安定成長期", text: "会社と個人のうち、目安に届いていない側から備えるのがひとつの考え方です。合算の現預金が目安に届かないあいだは、役員報酬を増やすのを急がないほうが落ち着いて進められます。" },
  { key: "stable", label: "安定成長期", text: "個人の現預金を厚くしていく時期と考えられます。利益が出ているあいだは、役員報酬の見直しで個人の側に移していくこともできます。" },
  { key: "mature", label: "成熟期", text: "個人の側を中心に備え、事業の引き継ぎ・相続・退職金の準備を始める時期と考えられます。" },
  { key: "crisis", label: "異常時", text: "会社の資金繰りを優先する時期です。会社の手元のお金、金融機関からの借入、個人の財産の順に検討するのがひとつの考え方です。" },
] as const;

export type CompanyStage = (typeof COMPANY_STAGES)[number]["key"];

/** 実力に直す点検の一覧（FP が直した額を入れる。amount: false は額を入れない点検だけの項目） */
export const RESTATE_ITEMS = [
  { key: "receivables", label: "売上債権", hint: "回収できない売掛金・受取手形を除いた額", amount: true },
  { key: "inventory", label: "在庫", hint: "長く動いていない在庫を除いた額", amount: true },
  { key: "buildings", label: "建物など", hint: "建物・車・備品は、売れる額に近い額（ゼロに近く見ることもあります）", amount: true },
  { key: "land", label: "土地", hint: "時価（路線価から見るときは、市場の値より低めに出ることを踏まえて）", amount: true },
  { key: "investments", label: "投資など", hint: "上場していない株や、返ってくる見込みの低い貸付金などを除いた額", amount: true },
  { key: "loanToOwner", label: "経営者への貸付金", hint: "合算では経営者の会社からの借入金と相殺するので、額は入れません", amount: false },
  { key: "guaranteed", label: "会社が保証している債務", hint: "ほかの会社などのために会社が保証している額（入れると負債に足します）", amount: true },
] as const;

export type RestateKey = Exclude<(typeof RESTATE_ITEMS)[number]["key"], "loanToOwner">;
const RESTATE_KEYS: readonly RestateKey[] = ["receivables", "inventory", "buildings", "land", "investments", "guaranteed"];

/** 世帯ファイルに持つ入力（household.companyBs。計算の要求には入れない。0108） */
export interface CombinedBsInput {
  version: 1;
  /** 会社のバランスシートの基準日（会社の最新の試算表の月末。YYYY-MM）。空は null */
  asOf: string | null;
  /** 科目ごとの額（円。剰余金だけマイナスもある。入れていない科目は持たない） */
  amounts: Partial<Record<CompanyKey, Yen>>;
  /** 会社の段階（選んでいなければ null） */
  stage: CompanyStage | null;
  /** 経営者（家計）の毎月の固定の支出（円。空は null＝家計の生活費＋ローン返済から） */
  ownerMonthly: Yen | null;
  /** 実力に直した額（FP が入れたものだけ） */
  restated: Partial<Record<RestateKey, Yen>>;
  /** 直した額で並べるか */
  useRestated: boolean;
}

export const EMPTY_COMBINED_INPUT: CombinedBsInput = { version: 1, asOf: null, amounts: {}, stage: null, ownerMonthly: null, restated: {}, useRestated: false };

/** 額の上限（1兆円） */
export const COMBINED_YEN_MAX = 1_000_000_000_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const yenOk = (v: unknown, neg = false): v is number => typeof v === "number" && Number.isInteger(v) && v <= COMBINED_YEN_MAX && v >= (neg ? -COMBINED_YEN_MAX : 0);

/** 世帯ファイルの値を読む（形の合わない所は捨てる。何も無ければ null） */
export function readCombinedInput(v: unknown): CombinedBsInput | null {
  if (!isObj(v)) return null;
  const amounts: CombinedBsInput["amounts"] = {};
  if (isObj(v.amounts)) for (const k of COMPANY_KEYS) if (yenOk(v.amounts[k], k === "retained")) amounts[k] = v.amounts[k] as number;
  const restated: CombinedBsInput["restated"] = {};
  if (isObj(v.restated)) for (const k of RESTATE_KEYS) if (yenOk(v.restated[k])) restated[k] = v.restated[k] as number;
  const asOf = typeof v.asOf === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v.asOf) ? v.asOf : null;
  const stage = COMPANY_STAGES.some((s) => s.key === v.stage) ? (v.stage as CompanyStage) : null;
  const ownerMonthly = yenOk(v.ownerMonthly) ? v.ownerMonthly : null;
  const out: CombinedBsInput = { version: 1, asOf, amounts, stage, ownerMonthly, restated, useRestated: v.useRestated === true };
  return isEmptyCombinedInput(out) ? null : out;
}

/** 何も入れていないか（入れていなければ世帯ファイルに欄を持たない） */
export function isEmptyCombinedInput(c: CombinedBsInput): boolean {
  return c.asOf === null && Object.keys(c.amounts).length === 0 && c.stage === null && c.ownerMonthly === null && Object.keys(c.restated).length === 0 && !c.useRestated;
}

/** 会社の数字を入れたか（科目の額が1つでもあるか） */
export const hasCompanyAmounts = (c: CombinedBsInput | null | undefined): boolean => c != null && Object.values(c.amounts).some((x) => x !== 0);

// ---- 計算（足し算と引き算だけ） ----

/** 純資産の内訳（合算の1枚。会社の財産・ほかの株主の出資・個人の財産） */
export interface NetPart {
  key: "netCompany" | "netOthers" | "netOwner";
  label: string;
  amount: Yen;
}

/** 並べる1枚（BsAt と同じ形に、名前と純資産の内訳） */
export interface CombinedColumn extends BsAt {
  key: "owner" | "company" | "combined";
  name: string;
  /** 純資産の内訳（合算の1枚で、どれも0以上のときだけ） */
  netParts?: NetPart[];
}

/** 相殺する組 */
export interface CombinedPair {
  key: "shares" | "loanToCompany" | "loanFromCompany" | "unpaid";
  label: string;
  ownerLabel: string;
  companyLabel: string;
  owner: Yen;
  company: Yen;
}

export interface CombinedIndicator {
  key: "total" | "owner" | "company";
  label: string;
  cash: Yen;
  /** 毎月の固定の支出（無ければ null） */
  monthly: Yen | null;
  /** 何か月分（小数第1位まで。毎月の固定の支出が無ければ null） */
  months: number | null;
  text: string;
}

export interface CombinedBs {
  /** 基準日の文（例: 「2026年9月末」。無ければ null） */
  asOfLabel: string | null;
  /** ①並べる（家計・会社） */
  side: [CombinedColumn, CombinedColumn];
  /** ②相殺の後（家計・会社） */
  netted: [CombinedColumn, CombinedColumn];
  /** ③合算の1枚 */
  combined: CombinedColumn;
  /** 共通の縮尺（いちばん大きい1枚の高さに当たる額） */
  scale: Yen;
  pairs: CombinedPair[];
  /** 純資産の内訳（会社の財産＝剰余金・ほかの株主の出資・個人の財産。合計は合算の純資産） */
  netWorth: { company: Yen; others: Yen; owner: Yen; total: Yen };
  indicators: CombinedIndicator[];
  stage: { label: string; text: string } | null;
  /** 実力に直した額（入れた項目だけ。直した額で並べているか） */
  restated: { rows: { key: RestateKey; label: string; book: Yen | null; adjusted: Yen }[]; used: boolean };
  /** お知らせ（組の額が合わない・会社の資産と負債＋純資産が合わない・連帯保証の扱い） */
  notices: string[];
}

/** 合算に使う家計の側（今の年の家計のバランスシートと、毎月の固定の支出〔生活費＋ローン返済の月額〕・連帯保証の額） */
export interface CombinedHousehold {
  at: BsAt;
  /** 生活費＋ローン返済の月額（家賃収入で返す不動産のローンは除く。0105 の3） */
  monthly: Yen;
  /** 会社の借入の連帯保証の額（今の額） */
  guarantee: Yen;
}

const man = (yen: number) => Math.round(yen / 10000).toLocaleString("ja-JP");
const mn = (yen: number) => `${man(yen)}万円`;

/** 何か月分の目安の文（目安は6か月分、できれば12か月分。届かないときは段で目指す） */
export function monthsGuideText(months: number | null): string {
  if (months === null) return "毎月の固定の支出を入れると、何か月分かを出します。";
  if (months >= 12) return "目安の6か月分を満たし、12か月分にも届いています。";
  if (months >= 6) return "目安の6か月分に届いています。できれば12か月分を目指しましょう。";
  if (months >= 3) return "目安の6か月分より少なめです。まず6か月分を目指しましょう。";
  return "目安の6か月分より少なめです。まず3か月分、次に6か月分を目指しましょう。";
}

const ymLabel = (ym: string | null) => (ym === null ? null : `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月末`);

function column(key: CombinedColumn["key"], name: string, lines: BsLine[], year: number): CombinedColumn {
  const kept = lines.filter((l) => l.amount > 0);
  const isDebt = (g: BsGroup) => g === "mortgage" || g === "debt";
  const totalAssets = kept.filter((l) => !isDebt(l.group)).reduce((s, l) => s + l.amount, 0);
  const totalLiabilities = kept.filter((l) => isDebt(l.group)).reduce((s, l) => s + l.amount, 0);
  const financial = kept.filter((l) => l.group === "liquid" || l.group === "market" || l.group === "locked").reduce((s, l) => s + l.amount, 0);
  const shortfall = kept.filter((l) => l.key === "short").reduce((s, l) => s + l.amount, 0);
  return { key, name, year, lines: kept, totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities, financial, shortfall };
}

/** 家計の側の、相殺する項目の額（自社株〔出資額〕・会社への貸付金・会社からの借入金） */
const lineAmount = (at: BsAt, key: string) => at.lines.filter((l) => l.key === key).reduce((s, l) => s + l.amount, 0);

/**
 * 合算BS を作る。company は世帯ファイルの入力、household は今の年の家計のバランスシート。
 * 組の両側が合わないときは会社の側の額に合わせる（両側をそれぞれ全部消し、差は個人の財産に入る）
 */
export function combinedBs(input: CombinedBsInput, household: CombinedHousehold): CombinedBs {
  const a = (k: CompanyKey) => input.amounts[k] ?? 0;
  const used = input.useRestated && Object.keys(input.restated).length > 0;
  const restatedOf = (k: RestateKey, book: number) => (used && input.restated[k] !== undefined ? (input.restated[k] as number) : book);
  const year = household.at.year;

  // 会社の科目（直した額で並べるときは、直した額）
  const companyAmount = (k: CompanyAssetKey): number => (k === "receivables" || k === "inventory" || k === "buildings" || k === "land" || k === "investments" ? restatedOf(k, a(k)) : a(k));
  const coLine = (k: CompanyAssetKey | CompanyLiabilityKey, label: string, group: BsGroup, amount: number): BsLine => ({ key: `co-${k}`, label, group, amount });
  const coAssets = COMPANY_ASSETS.map((x) => coLine(x.key, x.label, x.key === "cash" ? "liquid" : "illiquid", companyAmount(x.key)));
  const coLiabs = COMPANY_LIABILITIES.map((x) => coLine(x.key, x.label, "debt", a(x.key)));
  const guaranteed = used ? (input.restated.guaranteed ?? 0) : 0;
  if (guaranteed > 0) coLiabs.push({ key: "co-guaranteed", label: "会社が保証している債務", group: "debt", amount: guaranteed });
  const coLines = [...coAssets, ...coLiabs];

  const ownerName = "経営者個人（家計）";
  const companyName = used ? "会社（直した額）" : "会社";
  const side: [CombinedColumn, CombinedColumn] = [column("owner", ownerName, household.at.lines, year), column("company", companyName, coLines, year)];

  // ② 相殺の組（経営者の側 ↔ 会社の側）
  const capitalOwner = Math.max(0, a("capital") - a("otherCapital"));
  const pairs: CombinedPair[] = [
    { key: "shares", label: "自社株と資本金", ownerLabel: "自社株（出資額）", companyLabel: "資本金（ほかの株主の分を除く）", owner: lineAmount(household.at, "ownShares"), company: capitalOwner },
    { key: "loanToCompany", label: "会社への貸付金と、会社の経営者からの借入金", ownerLabel: "会社への貸付金", companyLabel: "経営者からの借入金", owner: lineAmount(household.at, "loanToCompany"), company: a("loanFromOwner") },
    { key: "loanFromCompany", label: "会社からの借入金と、会社の経営者への貸付金", ownerLabel: "会社からの借入金", companyLabel: "経営者への貸付金", owner: lineAmount(household.at, "companyLoan"), company: a("loanToOwner") },
    { key: "unpaid", label: "会社への未払金と、会社の経営者への立替金", ownerLabel: "会社への未払金", companyLabel: "経営者への立替金", owner: 0, company: a("advanceToOwner") },
  ];
  const OWNER_OUT = new Set(["ownShares", "loanToCompany", "companyLoan"]);
  const COMPANY_OUT = new Set(["co-loanToOwner", "co-advanceToOwner", "co-loanFromOwner"]);
  const netted: [CombinedColumn, CombinedColumn] = [
    column("owner", `${ownerName}・相殺の後`, household.at.lines.filter((l) => !OWNER_OUT.has(l.key)), year),
    column("company", `${companyName}・相殺の後`, coLines.filter((l) => !COMPANY_OUT.has(l.key)), year),
  ];

  // ③ 合算（科目はそのまま並べる。会社の科目は「（会社）」を添える）
  const tag = (l: BsLine): BsLine => (l.key.startsWith("co-") ? { ...l, label: `${l.label}（会社）` } : l);
  const combined = column("combined", "合算（経営者個人＋会社）", [...netted[0].lines, ...netted[1].lines].map(tag).sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group)), year);

  // 純資産の内訳: 会社の財産は剰余金（直した額で並べるときは、直した資産と負債から出した額−資本金）。資本金は財産に数えない
  const companyEquity = side[1].netWorth; // 会社の資産−負債（資本金＋剰余金に当たる）
  const others = Math.min(a("otherCapital"), Math.max(0, a("capital")));
  const retained = companyEquity - a("capital");
  const owner = combined.netWorth - retained - others;
  const netWorth = { company: retained, others, owner, total: combined.netWorth };
  if (retained >= 0 && owner >= 0 && combined.netWorth >= 0) {
    combined.netParts = [
      ...(retained > 0 ? [{ key: "netCompany" as const, label: "会社の財産（剰余金）", amount: retained }] : []),
      ...(others > 0 ? [{ key: "netOthers" as const, label: "ほかの株主の出資", amount: others }] : []),
      ...(owner > 0 ? [{ key: "netOwner" as const, label: "個人の財産", amount: owner }] : []),
    ];
  }

  // 指標: 現預金 ÷ 毎月の固定の支出
  const ownerCash = household.at.lines.filter((l) => l.group === "liquid").reduce((s, l) => s + l.amount, 0);
  const coCash = a("cash");
  const ownerMonthly = input.ownerMonthly ?? (household.monthly > 0 ? household.monthly : 0);
  const coMonthly = a("monthlyFixed") + a("monthlyLoanPay");
  const ind = (key: CombinedIndicator["key"], label: string, cash: number, monthly: number): CombinedIndicator => {
    const months = monthly > 0 ? Math.round((cash / monthly) * 10) / 10 : null;
    return { key, label, cash, monthly: monthly > 0 ? monthly : null, months, text: monthsGuideText(months) };
  };
  const indicators = [ind("total", "総合（合算）", ownerCash + coCash, ownerMonthly + coMonthly), ind("owner", "個人（家計）", ownerCash, ownerMonthly), ind("company", "会社", coCash, coMonthly)];

  const stageDef = COMPANY_STAGES.find((s) => s.key === input.stage);
  const restatedRows = RESTATE_KEYS.filter((k) => input.restated[k] !== undefined).map((k) => ({
    key: k,
    label: RESTATE_ITEMS.find((x) => x.key === k)?.label ?? k,
    book: k === "guaranteed" ? null : a(k),
    adjusted: input.restated[k] as number,
  }));

  // お知らせ
  const notices: string[] = [];
  const near = (x: number, y: number) => Math.round(x / 10000) === Math.round(y / 10000);
  for (const p of pairs) {
    if (near(p.owner, p.company)) continue;
    const one = p.owner === 0 || p.company === 0 ? "片方にしか載っていません。" : "";
    const fix = p.key === "unpaid" ? "家計の負債に入れていなければ、合算では入れたものとして見ています。" : p.owner < p.company ? "家計の入力に書き漏れがあれば、直してください。" : "会社の数字か家計の入力を確かめてください。";
    notices.push(`${p.label}: ${one}経営者の側は${mn(p.owner)}、会社の側は${mn(p.company)}です。合算では会社の側の額に合わせて見ています。${fix}`);
  }
  const bookEquity = COMPANY_ASSETS.reduce((s, x) => s + a(x.key), 0) - COMPANY_LIABILITIES.reduce((s, x) => s + a(x.key), 0);
  if (input.amounts.retained !== undefined && !near(bookEquity, a("capital") + a("retained"))) {
    notices.push(`会社の資産の合計と、負債と純資産（資本金・剰余金）の合計が${mn(Math.abs(bookEquity - a("capital") - a("retained")))}違います。図では剰余金を「資産−負債−資本金」で見ています。試算表の数字を確かめてください。`);
  }
  if (household.guarantee > 0) notices.push(`経営者の連帯保証（${mn(household.guarantee)}）は、会社の借入金として合算の負債に入っているので、二重には数えません。`);

  const all = [...side, ...netted, combined];
  return {
    asOfLabel: ymLabel(input.asOf),
    side,
    netted,
    combined,
    scale: Math.max(1, ...all.map((c) => Math.max(c.totalAssets, c.totalLiabilities))),
    pairs,
    netWorth,
    indicators,
    stage: stageDef === undefined ? null : { label: stageDef.label, text: stageDef.text },
    restated: { rows: restatedRows, used },
    notices,
  };
}

const GROUP_ORDER: readonly BsGroup[] = ["liquid", "market", "locked", "illiquid", "mortgage", "debt"];
