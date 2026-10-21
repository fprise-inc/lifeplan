// お金の3つの分け方（0032）: 今の時点の金融資産を、使う時期で「使うお金」「貯めるお金」「増やすお金」に分け、今の置き場所と並べる説明用の値。
// - 計算の結果（年ごとの表のマス）から出すだけで、キャッシュフロー表・結果の計算（runEngine）には混ぜない。計算エンジンのまとめた JS にも入れない
//   （画面・持ち帰り用のレポート・提案書の側が、この関数を同じ形で呼ぶ）。
// - 今の時点は計算基準年（資産と負債のタブの「今」と同じ、その年の年末の残高）。先の年は、その翌年から数える。
// - 使うお金 ＝ ふだんの支出（毎年続く支出）の月額 × 何か月。ふだんの支出は計算基準年の値（基準月が年の途中なら、1年分そろう翌年の値）。
// - 貯めるお金 ＝ 今後 N 年の各年の「できごとの支出 − 収入の残り（手取り収入 − ふだんの支出）」のうち、プラスの年だけの合計（黒字の繰り越しはしない）。
// - 増やすお金 ＝ 金融資産の合計 − 使うお金 − 貯めるお金（マイナスのこともある）。
// - 差（預金など − 使うお金 − 貯めるお金）が、ふだんの支出の1か月分より小さいときは「ほぼ同じ」。
// 金額は円の整数（0002）。掛け算・割り算は規則IDつきの丸めだけ
import { EngineError } from "../errors.ts";
import { CONVENTIONS } from "../money/conventions.ts";
import { divInt, mulRatio } from "../money/rounding.ts";
import { addYen, subYen, yen, YEN_ZERO, type Yen } from "../money/yen.ts";

/** 年ごとの表のマス（計算の結果の table と同じ形） */
export interface MoneyThreeCell {
  readonly row: string;
  readonly year: number;
  readonly amount: number;
  readonly member?: string;
  readonly object?: string;
}

/** 計算の要求のうち、この関数が読むところ */
export interface MoneyThreeRequest {
  readonly input: {
    readonly baseMonth: string;
    readonly endYear: number;
    readonly household: { readonly periodicExpenses?: readonly { readonly id: string; readonly everyYears: number }[] };
  };
}

/** 今の置き場所（計算基準年の年末の残高。資産と負債のタブの「今」と同じ分け方で出したもの） */
export interface MoneyThreePlacement {
  /** すぐ使えるお金（預金など） */
  readonly liquid: number;
  /** 金融資産の合計（すぐ使える・値動きあり・引き出せない） */
  readonly financial: number;
}

export interface MoneyThreeOptions {
  /** 使うお金: ふだんの支出の何か月分か（1〜24） */
  readonly months: number;
  /** 貯めるお金: 今後何年のできごとを数えるか（1〜30） */
  readonly years: number;
}

export const MONEY_THREE_MONTHS = { min: 1, max: 24, default: 6 } as const;
export const MONEY_THREE_YEARS = { min: 1, max: 30, default: 10 } as const;

/** ふだんの支出の中身 */
export type MoneyThreeRegularKind = "living" | "housing" | "insurance" | "other";
export const MONEY_THREE_REGULAR_KINDS: readonly MoneyThreeRegularKind[] = ["living", "housing", "insurance", "other"];

/** できごとの支出の種類 */
export type MoneyThreeEventKind = "education" | "carPurchase" | "carLoan" | "homePurchase" | "prepayment" | "care" | "periodic" | "wedding" | "gift" | "funeral" | "lumpSum";

/** その年のできごとの支出の1つ（種類・構成員・物ごとの合計） */
export interface MoneyThreeEventPart {
  readonly kind: MoneyThreeEventKind;
  /** その種類の最初の行（周期的な支出の載せる行など。名前を決めるのに使う） */
  readonly row: string;
  readonly member?: string;
  readonly object?: string;
  readonly amount: Yen;
}

/** 貯めるお金の年ごとの内訳（できごとの支出がある年だけ） */
export interface MoneyThreeYear {
  readonly year: number;
  /** できごとの支出（大きい順） */
  readonly parts: readonly MoneyThreeEventPart[];
  readonly eventTotal: Yen;
  /** 手取り収入（収入 − 税・社会保険料） */
  readonly takeHome: Yen;
  /** ふだんの支出 */
  readonly regular: Yen;
  /** 収入の残り（手取り収入 − ふだんの支出。マイナスもある） */
  readonly leftover: Yen;
  /** 賄えない分（できごとの支出 − 収入の残り。0 以上） */
  readonly uncovered: Yen;
}

export type MoneyThreeStatus = "over" | "short" | "even";

export interface MoneyThreeResult {
  /** 今の時点の年（計算基準年） */
  readonly baseYear: number;
  readonly months: number;
  readonly years: number;
  /** 使うお金 */
  readonly spend: {
    readonly amount: Yen;
    /** ふだんの支出を見た年（計算基準年。基準月が年の途中なら翌年） */
    readonly year: number;
    /** ふだんの支出の年額 */
    readonly annual: Yen;
    /** ふだんの支出の月額（年額 ÷ 12、円未満切り捨て） */
    readonly monthly: Yen;
    /** 中身ごとの月額（並びは MONEY_THREE_REGULAR_KINDS。0 の中身も入れる。合計は monthly と1円単位で違うことがある） */
    readonly parts: readonly { readonly kind: MoneyThreeRegularKind; readonly monthly: Yen }[];
  };
  /** 貯めるお金 */
  readonly save: {
    readonly amount: Yen;
    /** 数えた年の範囲（今の時点の翌年から。プランの最後の年で止まる） */
    readonly fromYear: number;
    readonly toYear: number;
    /** 何年先までがプランの最後の年を超えて、短くなった */
    readonly clipped: boolean;
    /** できごとの支出がある年（年の順） */
    readonly rows: readonly MoneyThreeYear[];
  };
  /** 増やすお金（金融資産 − 使う − 貯める。マイナスのこともある） */
  readonly grow: Yen;
  readonly placement: { readonly liquid: Yen; readonly financial: Yen };
  /** 使うお金＋貯めるお金 */
  readonly need: Yen;
  /** すぐ使えるお金 − (使うお金＋貯めるお金)。プラスなら増やすお金の分にある預金など、マイナスなら預金などで足りない分 */
  readonly gap: Yen;
  /** 金融資産の合計でも足りない分（0 以上） */
  readonly overFinancial: Yen;
  /** 「ほぼ同じ」とする差の幅（ふだんの支出の1か月分） */
  readonly threshold: Yen;
  readonly status: MoneyThreeStatus;
}

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");

/** ふだんの支出にもできごとの支出にも数えない行: ゆとりの支出（黒字から出る支出。0031）と、取り崩しの計画で使うお金（0026） */
const EXCLUDED = new Set(["cf.expense.living.surplus", "cf.expense.living.drawdown"]);

/** できごとの支出の行（周期的な支出は物で決める） */
function eventKindOfRow(row: string): MoneyThreeEventKind | null {
  if (under(row, "cf.expense.education")) return "education";
  if (under(row, "cf.expense.lumpSum.car")) return "carPurchase";
  if (under(row, "cf.expense.debt.car")) return "carLoan";
  if (under(row, "cf.expense.housing.purchase")) return "homePurchase";
  if (under(row, "cf.expense.housing.loan.prepayment")) return "prepayment";
  if (under(row, "cf.expense.care")) return "care";
  if (under(row, "cf.expense.lumpSum.wedding")) return "wedding";
  if (under(row, "cf.expense.lumpSum.gift")) return "gift";
  if (under(row, "cf.expense.lumpSum.funeral")) return "funeral";
  if (under(row, "cf.expense.lumpSum")) return "lumpSum";
  return null;
}

function regularKindOfRow(row: string): MoneyThreeRegularKind {
  if (under(row, "cf.expense.living")) return "living";
  if (under(row, "cf.expense.housing")) return "housing";
  if (under(row, "cf.expense.insurance")) return "insurance";
  return "other";
}

function checkInt(v: number, min: number, max: number, what: string): void {
  if (typeof v !== "number" || v % 1 !== 0 || v < min || v > max) throw new EngineError("E_ARGUMENT", [what]);
}

const RULE = () => {
  const r = CONVENTIONS["conv.moneyThree.monthly"];
  if (r === undefined) throw new EngineError("E_ROUNDING_UNKNOWN", ["conv.moneyThree.monthly"]);
  return r;
};

/** お金の3つの分け方（0032） */
export function moneyThree(req: MoneyThreeRequest, table: readonly MoneyThreeCell[], placement: MoneyThreePlacement, opt: MoneyThreeOptions): MoneyThreeResult {
  checkInt(opt.months, MONEY_THREE_MONTHS.min, MONEY_THREE_MONTHS.max, "moneyThree.months");
  checkInt(opt.years, MONEY_THREE_YEARS.min, MONEY_THREE_YEARS.max, "moneyThree.years");
  const m = /^(\d{4})-(\d{2})$/.exec(req.input.baseMonth);
  if (m === null) throw new EngineError("E_ARGUMENT", ["moneyThree.baseMonth"]);
  const baseYear = Number(m[1]);
  const baseMonthNo = Number(m[2]);
  const endYear = req.input.endYear;
  const liquid = yen(placement.liquid);
  const financial = yen(placement.financial);

  // 周期的な支出: 2年以上ごとならできごと、毎年ならふだんの支出（載せる行に関係なく）
  const periodic = new Map((req.input.household.periodicExpenses ?? []).map((p) => [p.id, p.everyYears]));
  type Sort = { event: MoneyThreeEventKind } | { regular: MoneyThreeRegularKind } | null;
  const sortOf = (c: MoneyThreeCell): Sort => {
    if (!under(c.row, "cf.expense") || EXCLUDED.has(c.row)) return null;
    const every = c.object !== undefined ? periodic.get(c.object) : undefined;
    if (every !== undefined) return every >= 2 ? { event: "periodic" } : { regular: regularKindOfRow(c.row) };
    const ev = eventKindOfRow(c.row);
    return ev !== null ? { event: ev } : { regular: regularKindOfRow(c.row) };
  };

  // 年ごとの手取り収入・ふだんの支出（中身ごと）・できごとの支出（種類・構成員・物ごと）
  const takeHome = new Map<number, Yen>();
  const regular = new Map<number, Map<MoneyThreeRegularKind, Yen>>();
  const events = new Map<number, Map<string, { kind: MoneyThreeEventKind; row: string; member?: string; object?: string; amount: Yen }>>();
  const add = (map: Map<number, Yen>, y: number, v: Yen) => map.set(y, addYen(map.get(y) ?? YEN_ZERO, v));
  for (const c of table) {
    const amount = yen(c.amount);
    if (under(c.row, "cf.income")) add(takeHome, c.year, amount);
    else if (under(c.row, "cf.taxSi")) add(takeHome, c.year, yen(-amount));
    const s = sortOf(c);
    if (s === null) continue;
    if ("regular" in s) {
      let r = regular.get(c.year);
      if (r === undefined) regular.set(c.year, (r = new Map()));
      r.set(s.regular, addYen(r.get(s.regular) ?? YEN_ZERO, amount));
    } else {
      let e = events.get(c.year);
      if (e === undefined) events.set(c.year, (e = new Map()));
      const key = `${s.event}|${c.member ?? ""}|${c.object ?? ""}`;
      const p = e.get(key);
      if (p !== undefined) p.amount = addYen(p.amount, amount);
      else e.set(key, { kind: s.event, row: c.row, ...(c.member !== undefined ? { member: c.member } : {}), ...(c.object !== undefined ? { object: c.object } : {}), amount });
    }
  }
  const regularOf = (y: number): Yen => {
    let s = YEN_ZERO;
    for (const v of regular.get(y)?.values() ?? []) s = addYen(s, v);
    return s;
  };

  // 使うお金
  const spendYear = baseMonthNo > 1 && baseYear < endYear ? baseYear + 1 : baseYear;
  const annual = regularOf(spendYear);
  const rule = RULE();
  const monthly = divInt(annual, 12, rule).value;
  const spend = mulRatio(annual, opt.months, 12, rule).value;
  const parts = MONEY_THREE_REGULAR_KINDS.map((kind) => ({ kind, monthly: divInt(regular.get(spendYear)?.get(kind) ?? YEN_ZERO, 12, rule).value }));

  // 貯めるお金
  const fromYear = baseYear + 1;
  const wantTo = baseYear + opt.years;
  const toYear = wantTo < endYear ? wantTo : endYear;
  const rows: MoneyThreeYear[] = [];
  let save = YEN_ZERO;
  for (let y = fromYear; y <= toYear; y++) {
    const e = events.get(y);
    if (e === undefined) continue;
    const ps = [...e.values()].filter((p) => p.amount > 0);
    if (ps.length === 0) continue;
    ps.sort((a, b) => b.amount - a.amount);
    let eventTotal = YEN_ZERO;
    for (const p of ps) eventTotal = addYen(eventTotal, p.amount);
    const th = takeHome.get(y) ?? YEN_ZERO;
    const reg = regularOf(y);
    const leftover = subYen(th, reg);
    const diff = subYen(eventTotal, leftover);
    const uncovered = diff > 0 ? diff : YEN_ZERO;
    save = addYen(save, uncovered);
    rows.push({ year: y, parts: ps, eventTotal, takeHome: th, regular: reg, leftover, uncovered });
  }

  // 増やすお金と、今の置き場所との差
  const need = addYen(spend, save);
  const grow = subYen(financial, need);
  const gap = subYen(liquid, need);
  const overFinancial = grow < 0 ? yen(-grow) : YEN_ZERO;
  const threshold = monthly;
  const abs = gap < 0 ? -gap : gap;
  const status: MoneyThreeStatus = abs === 0 || abs < threshold ? "even" : gap > 0 ? "over" : "short";
  return {
    baseYear,
    months: opt.months,
    years: opt.years,
    spend: { amount: spend, year: spendYear, annual, monthly, parts },
    save: { amount: save, fromYear, toYear, clipped: wantTo > endYear, rows },
    grow,
    placement: { liquid, financial },
    need,
    gap,
    overFinancial,
    threshold,
    status,
  };
}
