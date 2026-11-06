// 資産と負債のタブ（家計のバランスシート）の提示用の値を作る（作業の層。0016 の2・0025・0027）。
// - 分け方は提案書と同じ部品（report/src/bsGroups.ts）: 資産を「すぐ使えるお金・値動きのある運用・引き出せないお金・換金しにくい資産」に、
//   負債を「住宅ローン・その他の負債（資金の不足を含む）」に分ける。資産の合計＝負債の合計＋純資産。
// - 年は計算基準年（今。入力した値から出した事実）から表の最後の年まで。先の年は見込み。
// - ひと言の解説・箱の説明・この年の出来事もここで作る（提示層は受け取った文を出すだけ）。物の ID・FP のメモは渡さない
import type { EngineRequest, TableCell } from "../engine/types.ts";
import { bsHouseholdOf, bsSeries, BS_GROUP_LABEL, BS_GROUP_SHORT, groupTotal, type BsAt, type BsGroup } from "../../../report/src/index.ts";
import type { BalanceTabModel, BsColumn, BsCustomViewModel, BsGroupKey, BsGuide, BsGuideBasis, BsMarkKind, BsPlanModel, BsPointKey, BsPointModel, BsPrevModel, BsYearModel, VerdictPart } from "../presentation/model.ts";
import { man } from "../presentation/format.ts";
import { addMonths, ageReachedMonth, parseYm, readLevers } from "./levers.ts";
import { ageAxis, depletionYear, eventsOf, SURPLUS_ROW } from "./present.ts";
import { ageInYear, leaveYear, presentInYear, roles, type Role } from "./roles.ts";
import { guaranteeTotal, hasExecutive } from "./input/officer.ts";

/** 家計の体力の目安の幅の最初の値（事務所の設定で FP が変えられる） */
export const DEFAULT_BS_GUIDE: BsGuide = { months: [6, 12], risk: [10, 40], debt: 50 };

/** 目安の幅を読む（保存した表示の設定から。形が合わなければ最初の値） */
export function readBsGuide(v: unknown): BsGuide {
  const d = DEFAULT_BS_GUIDE;
  if (typeof v !== "object" || v === null) return d;
  const o = v as Record<string, unknown>;
  const pair = (x: unknown, def: [number, number], max: number): [number, number] => {
    if (!Array.isArray(x) || x.length !== 2) return def;
    const [a, b] = x as unknown[];
    return typeof a === "number" && typeof b === "number" && a >= 0 && b > a && b <= max ? [a, b] : def;
  };
  const debt = typeof o.debt === "number" && o.debt > 0 && o.debt <= 100 ? o.debt : d.debt;
  const basis = o.basis === "living" || o.basis === "livingLoan" ? { basis: o.basis as BsGuideBasis } : {};
  return { ...basis, months: pair(o.months, d.months, 120), risk: pair(o.risk, d.risk, 100), debt };
}

/** 分母を選んでいないときの分母: 役員として働く人のいる世帯は生活費＋ローン返済、ほかは生活費（0105） */
export function defaultGuideBasis(req: EngineRequest): BsGuideBasis {
  return hasExecutive(req.input.household) ? "livingLoan" : "living";
}

/** ローンの返済の行（家計の体力の目安の「生活費＋ローン返済」に数える。繰上返済・手数料の行は数えない） */
const LOAN_PAY_ROWS: ReadonlySet<string> = new Set(["cf.expense.housing.loan", "cf.expense.debt.car", "cf.expense.debt.scholarship", "cf.expense.debt.other"]);

/** 時点を並べるときの候補（並びは選ぶ画面の順）。年齢は本人の年齢 */
export const BS_POINT_CHOICES: readonly { key: BsPointKey; label: string; note: string }[] = [
  { key: "now", label: "今", note: "計算基準年の年末（入力した事実）" },
  { key: "y5", label: "5年後", note: "" },
  { key: "y10", label: "10年後", note: "" },
  { key: "y20", label: "20年後", note: "" },
  { key: "childIndep", label: "子の独立", note: "一番下の子が独立する年（子のいる世帯）" },
  { key: "loanEnd", label: "ローン完済", note: "住宅ローンを返し終わる年（ローンのある世帯）" },
  { key: "retire", label: "退職の年", note: "ご本人が退職する年" },
  { key: "pension", label: "年金の始まり", note: "ご本人の年金の受け取りが始まる年" },
  { key: "age65", label: "65歳", note: "" },
  { key: "age70", label: "70歳", note: "" },
  { key: "age75", label: "75歳", note: "" },
  { key: "age80", label: "80歳", note: "" },
  { key: "age85", label: "85歳", note: "" },
  { key: "age90", label: "90歳", note: "" },
];

/** 時点を並べるときの既定（最初の値: 今・退職の年・75歳） */
export const DEFAULT_BS_POINTS: BsPointKey[] = ["now", "retire", "age75"];
/** 並べる数（2〜4つ。3つが基本） */
export const BS_COLUMNS_MIN = 2;
export const BS_COLUMNS_MAX = 4;

const isPointKey = (v: unknown): v is BsPointKey => BS_POINT_CHOICES.some((c) => c.key === v);

/** 既定の時点を読む（保存した表示の設定から。2〜4つの候補の鍵で、重なりなし。形が合わなければ最初の値） */
export function readBsPoints(v: unknown): BsPointKey[] {
  if (!Array.isArray(v)) return [...DEFAULT_BS_POINTS];
  const keys = v.filter(isPointKey).filter((k, i, a) => a.indexOf(k) === i);
  return keys.length >= BS_COLUMNS_MIN && keys.length <= BS_COLUMNS_MAX && keys.length === v.length ? keys : [...DEFAULT_BS_POINTS];
}

/** この世帯で選んだ並べる時点を読む（2〜4つ。候補の鍵か決まった年。形が合わなければ null＝既定のまま） */
export function readBsColumns(v: unknown): BsColumn[] | null {
  if (!Array.isArray(v) || v.length < BS_COLUMNS_MIN || v.length > BS_COLUMNS_MAX) return null;
  const out: BsColumn[] = [];
  for (const x of v as unknown[]) {
    if (typeof x !== "object" || x === null) return null;
    const o = x as Record<string, unknown>;
    if (isPointKey(o.point)) out.push({ point: o.point });
    else if (typeof o.year === "number" && Number.isInteger(o.year) && o.year >= 1900 && o.year <= 2300) out.push({ year: o.year });
    else return null;
  }
  return out;
}

/** タブの年: 計算基準年（今）から表の最後の年まで */
export function bsYears(req: EngineRequest): number[] {
  const { y } = parseYm(req.input.baseMonth);
  const out: number[] = [];
  for (let year = y; year <= req.input.endYear; year++) out.push(year);
  return out;
}

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");

/** 年ごとの合計（条件に合うマス） */
function byYear(table: readonly TableCell[], years: readonly number[], pred: (c: TableCell) => boolean): number[] {
  const idx = new Map(years.map((y, i) => [y, i]));
  const out = years.map(() => 0);
  for (const c of table) {
    const i = idx.get(c.year);
    if (i !== undefined && pred(c)) out[i] = (out[i] as number) + c.amount;
  }
  return out;
}

const mn = (v: number) => `${man(v)}万円`;
const strong = (text: string): VerdictPart => ({ text, strong: true });
const plain = (text: string): VerdictPart => ({ text });

export interface BsPlanInput {
  key: string;
  letter: string;
  name: string;
  title: string;
  base: boolean;
  req: EngineRequest;
  table: readonly TableCell[];
}

/** その年の世帯の年齢の文（ご本人・配偶者だけ。例: 「ご本人45歳・配偶者43歳」。結婚の予定の配偶者は加わる年から） */
function membersText(rs: readonly Role[], year: number): string {
  return rs
    .filter((r) => (r.key === "self" || r.key === "spouse") && presentInYear(r, year))
    .map((r) => `${r.label}${ageInYear(r.member, year)}歳`)
    .join("・");
}

const EVENT_KIND: Record<string, BsMarkKind> = { 退: "retire", 年: "pension", 家: "loan", "！": "short" };

/** 1つのプランのバランスシート（今の年から表の最後の年まで）と、つまみの札・主な年・解説 */
export function bsPlan(p: BsPlanInput): BsPlanModel {
  const req = p.req;
  const years = bsYears(req);
  const rs = roles(req);
  const self = rs.find((r) => r.key === "self");
  const ageOf = (y: number) => (self !== undefined ? ageInYear(self.member, y) : null);
  const who = self?.label ?? "";
  const ageText = (y: number) => (self !== undefined ? `${who}${ageInYear(self.member, y)}歳` : `${y}年`);
  const h = req.input.household;
  const at: BsAt[] = bsSeries(p.table, years, bsHouseholdOf(h));
  const lineOf = (i: number, key: string) => (at[i] as BsAt).lines.find((l) => l.key === key)?.amount ?? 0;
  const living = byYear(p.table, years, (c) => under(c.row, "cf.expense.living") && c.row !== "cf.expense.living.drawdown" && c.row !== SURPLUS_ROW);
  const loanPay = byYear(p.table, years, (c) => c.row === "cf.expense.housing.loan");
  // 家賃収入で返す住まい以外の不動産のローンは、家計の体力の目安の返済に数えない（0105）
  const propertyDebts = new Set((h.debts ?? []).filter((d) => d.property !== undefined).map((d) => d.id));
  const allLoanPay = byYear(p.table, years, (c) => LOAN_PAY_ROWS.has(c.row) && !(c.object !== undefined && propertyDebts.has(c.object)));
  // 計算基準年が年の途中から始まるとき、その年のお金の動きは数か月分しかないので、生活費と返済額は翌年（1年分）の値で見る
  if (parseYm(req.input.baseMonth).m > 1 && years.length > 1) {
    living[0] = living[1] as number;
    loanPay[0] = loanPay[1] as number;
    allLoanPay[0] = allLoanPay[1] as number;
  }
  const guarantee = guaranteeTotal(h);
  const g = (i: number, k: BsGroup) => groupTotal(at[i] as BsAt, k);

  // 年の出来事（グラフの下の丸と同じ）と、つまみの札
  const evs = eventsOf(req, p.table, years);
  const lv = self !== undefined ? readLevers(req, self.member.id) : {};
  const retireAge = lv.retireAge;
  const retireYear = self !== undefined && retireAge !== undefined ? parseYm(ageReachedMonth(self.member, retireAge)).y : null;
  const pensionAge = lv.pensionAge;
  const pensionYear = self !== undefined && pensionAge !== undefined ? parseYm(addMonths(ageReachedMonth(self.member, pensionAge), 1)).y : null;
  const dep = depletionYear(p.table, years);
  const negIdx = at.findIndex((x) => x.netWorth < 0);
  const loanEnd = evs.find((e) => e.icon === "家")?.year ?? null;
  const marks: BsPlanModel["marks"] = [];
  const idx = (y: number | null) => (y === null ? -1 : years.indexOf(y));
  if (idx(retireYear) >= 0) marks.push({ index: idx(retireYear), kind: "retire", label: `退職（${retireAge}）` });
  if (idx(loanEnd) >= 0) marks.push({ index: idx(loanEnd), kind: "loan", label: "ローン完済" });
  if (idx(dep) >= 0) marks.push({ index: idx(dep), kind: "short", label: "資金が不足" });
  if (negIdx >= 0) marks.push({ index: negIdx, kind: "neg", label: "純資産マイナス" });
  marks.sort((a, b) => a.index - b.index);

  const jumps: BsPlanModel["jumps"] = [];
  const pushJump = (key: BsPlanModel["jumps"][number]["key"], label: string, i: number) => {
    if (i >= 0 && i < years.length && !jumps.some((j) => j.index === i && j.key !== "now")) jumps.push({ key, label, index: i });
  };
  pushJump("now", "今", 0);
  pushJump("ten", "10年後", 10);
  if (retireYear !== null) pushJump("retire", "退職の年", idx(retireYear));
  if (self !== undefined) pushJump("age75", "75歳", idx(parseYm(self.member.birth.birthYearMonth).y + 75));

  // 時点を並べるときの候補（範囲の中にあるものだけ）
  const youngestLeaves = rs
    .filter((r) => r.member.kind === "child")
    .map((r) => leaveYear(r))
    .filter((y): y is number => y !== null)
    .sort((a, b) => a - b)
    .at(-1);
  const birthY = self !== undefined ? parseYm(self.member.birth.birthYearMonth).y : null;
  const pointIndex: Record<BsPointKey, number> = {
    now: 0,
    y5: 5,
    y10: 10,
    y20: 20,
    childIndep: idx(youngestLeaves ?? null),
    loanEnd: idx(loanEnd),
    retire: idx(retireYear),
    pension: idx(pensionYear),
    age65: birthY === null ? -1 : idx(birthY + 65),
    age70: birthY === null ? -1 : idx(birthY + 70),
    age75: birthY === null ? -1 : idx(birthY + 75),
    age80: birthY === null ? -1 : idx(birthY + 80),
    age85: birthY === null ? -1 : idx(birthY + 85),
    age90: birthY === null ? -1 : idx(birthY + 90),
  };
  const points: BsPointModel[] = BS_POINT_CHOICES.map((c) => ({ key: c.key, label: c.label, index: pointIndex[c.key] })).filter((x) => x.index >= 0 && x.index < years.length);

  const lastAge = ageOf(years.at(-1) ?? 0);
  const status = dep !== null ? { text: `${ageText(dep).replace(who, "")}で資金が不足`, ok: false } : { text: `${lastAge ?? ""}歳まで足りる`, ok: true };

  const out: BsYearModel[] = years.map((year, i) => {
    const a = at[i] as BsAt;
    const liquid = g(i, "liquid");
    const events: BsYearModel["events"] = evs.filter((e) => e.year === year).map((e) => ({ kind: EVENT_KIND[e.icon] ?? "other", text: e.text }));
    if (i === negIdx) events.push({ kind: "neg", text: "純資産がマイナスに" });
    const land = lineOf(i, "land");
    const building = lineOf(i, "building");
    const monthly = (living[i] ?? 0) / 12;
    const notes: BsYearModel["notes"] = {
      liquid: `今日・明日にでも使えるお金です。${monthly > 0 ? `生活費（月${mn(monthly)}）の${monthsText(liquid / monthly)}。` : ""}急な出費や、収入で足りない分はまずここから出ます。`,
      market: "株や投資信託など。売ればお金になりますが、そのときの相場で金額が変わります（口座に分けずにまとめて入れた金融資産も、ここに数えています）。",
      locked: "iDeCo・企業型DC・小規模企業共済など。原則として決まった年齢（iDeCo・企業型DCは60歳）まで引き出せません。受け取ると「すぐ使えるお金」に移ります。",
      illiquid: `住んでいる家・貸している不動産・使っている車・保険の解約返戻金など、すぐにはお金にしにくいもの。${lineOf(i, "ownShares") > 0 ? "自社株は出資額（払い込んだ額）で見ています。実際の株の価値はずっと高いことがあり、相続税に影響します。" : ""}${land + building > 0 ? `不動産は土地（${mn(land)}）と建物（${mn(building)}）に分けて見込んでいます。土地は上昇率で動かし、建物は構造の耐用年数で定額で減らして、建てたときの価値の一定の割合を下限に残します。建物は年数とともに価値が減りますが、土地は残ります。` : ""}`,
      mortgage: `${(loanPay[i] ?? 0) > 0 ? `年間の返済額は${mn(loanPay[i] ?? 0)}。` : ""}${loanEnd !== null && year <= loanEnd ? `${loanEnd}年（${ageText(loanEnd)}）に返し終わる見込みです。` : ""}返済のうち元金の分は、純資産として残ります。`,
      propertyLoan: "貸している不動産など、住まい以外の不動産を買うために借りたお金です。返済は家賃収入から出す前提で、毎年の支出の「不動産のローンの返済」に入っています。物件を売るときに返す予定なら、売る月に残りを一括で返します。",
      debt: a.shortfall > 0 ? "「資金の不足」は、金融資産が尽きた後に足りない分を、借りている状態として負債に置いたものです（実際には家の売却などで補う必要があります）。" : `車のローン・奨学金など、住宅ローンのほかに借りているお金です。${lineOf(i, "companyLoan") > 0 ? "会社からの借入金の返済は、毎年の支出に入っています。" : ""}`,
      netWorth: "持っているものを全部お金に換えて、借りているものを返したときに残る額です。家や車はすぐには使えないので、それを除いた額も添えています。",
      neg: "負債が資産より多い状態（債務超過）です。家や持ち物を全部お金に換えても、借りている分を返しきれません。左の箱の下に点線で置き、左右の高さをそろえています。",
    };
    return {
      year,
      age: ageOf(year),
      members: membersText(rs, year),
      fact: i === 0,
      lines: a.lines.map((l) => ({ key: l.key, label: l.label, group: l.group as BsGroupKey, amount: l.amount })),
      totalAssets: a.totalAssets,
      totalLiabilities: a.totalLiabilities,
      netWorth: a.netWorth,
      financial: a.financial,
      shortfall: a.shortfall,
      living: living[i] ?? 0,
      loanPay: allLoanPay[i] ?? 0,
      guarantee: i === 0 ? guarantee : 0,
      events,
      notes,
    };
  });
  return { key: p.key, letter: p.letter, name: p.name, title: p.title, base: p.base, years: out, axis: ageAxis(rs, years), marks, jumps, points, status };
}

/** 「○か月分」（2年以上は「○年分」） */
export function monthsText(m: number): string {
  if (!Number.isFinite(m)) return "";
  return m >= 24 ? `${(m / 12).toFixed(1)}年分` : `${m.toFixed(1)}か月分`;
}

// ---- 前回と比べる（控え）----

/** 控えの見込みの今と今の実際の差の、大きい項目（最大4つ） */
export function prevItems(expected: BsYearModel, actual: BsYearModel): string[] {
  const keys = new Map<string, { label: string; debt: boolean }>();
  for (const l of [...expected.lines, ...actual.lines]) keys.set(l.key, { label: l.label, debt: l.group === "mortgage" || l.group === "propertyLoan" || l.group === "debt" });
  const amt = (m: BsYearModel, k: string) => m.lines.find((l) => l.key === k)?.amount ?? 0;
  return [...keys.entries()]
    .map(([k, v]) => ({ ...v, d: amt(actual, k) - amt(expected, k) }))
    .filter((x) => Math.round(Math.abs(x.d) / 10000) >= 1)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 4)
    .map((x) => `${x.label}が見込みより${mn(Math.abs(x.d))}${x.d > 0 ? "多い" : "少ない"}${x.debt ? "（負債）" : ""}`);
}

/** 控えの日時から「○年前」「○か月前」 */
export function agoText(createdAt: string, baseMonth: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(createdAt);
  if (m === null) return "前回";
  const b = parseYm(baseMonth);
  const months = (b.y - Number(m[1])) * 12 + (b.m - Number(m[2]));
  if (months >= 12 && months % 12 === 0) return `${months / 12}年前`;
  if (months >= 12) return `${Math.floor(months / 12)}年${months % 12}か月前`;
  if (months > 0) return `${months}か月前`;
  return "今月";
}

/** 控えに見込みのバランスシートを出せるだけの内容があるか（資産・負債の入力が1つも無ければ出さない） */
export function snapshotHasBalance(req: EngineRequest): boolean {
  const h = req.input.household;
  return (h.accounts ?? []).length > 0 || (h.residences ?? []).some((r) => r.kind === "own") || (h.cars ?? []).length > 0 || (h.debts ?? []).length > 0;
}

/**
 * 前回と比べる: 控えの現状の入力で計算した、今の年（今の計算基準年）の見込みと、今の実際。
 * expected が出せないとき（計算できない・控えの期間の外・資産と負債の入力が無い）は reason に理由
 */
export function bsPrev(o: { key: string; label: string; createdAt: string; baseMonth: string; actual: BsYearModel; snapshot: { req: EngineRequest; table: readonly TableCell[] } | { error: string } }): BsPrevModel {
  const year = o.actual.year;
  const ago = agoText(o.createdAt, o.baseMonth);
  let expected: BsYearModel | null = null;
  let reason: string | null = null;
  if ("error" in o.snapshot) reason = o.snapshot.error;
  else if (!snapshotHasBalance(o.snapshot.req)) reason = "この控えには資産・負債の入力が無いため、見込みのバランスシートを出せません。";
  else {
    const plan = bsPlan({ key: "prev", letter: "", name: "", title: "", base: false, req: o.snapshot.req, table: o.snapshot.table });
    const y = plan.years.find((x) => x.year === year);
    if (y === undefined) reason = `この控えの計算の期間に${year}年が入っていないため、見込みを出せません。`;
    else expected = { ...y, fact: false };
  }
  const actual = o.actual;
  if (expected === null) return { key: o.key, label: o.label, ago, expected, reason, actual, summary: [plain(reason ?? "")], items: [] };
  const d = actual.netWorth - expected.netWorth;
  const summary: VerdictPart[] = [
    plain(`${ago === "今月" ? "今月の控えで" : `${ago}に`}見込んでいた今の純資産は${mn(expected.netWorth)}、今の実際は${mn(actual.netWorth)}。`),
    ...(Math.round(Math.abs(d) / 10000) === 0 ? [plain("ほぼ見込みどおりです。")] : [plain("見込みより純資産が "), strong(mn(Math.abs(d))), plain(` ${d > 0 ? "多く" : "少なく"}なっています。`)]),
  ];
  return { key: o.key, label: o.label, ago, expected, reason: null, actual, summary, items: prevItems(expected, actual) };
}

/**
 * customViews: カスタマイズで足す見るもの（0027 の8）。公式の画面が足すのは、事務所の設定で使うと決めた法人経営者向けの機能
 * （会社と合わせたバランスシート。役員として働く人のいる世帯だけ。0107）だけ。ほかは空
 */
export function balanceTabModel(o: { plans: BsPlanModel[]; selected: string; base: string; guide: BsGuide; guideBasis?: BsGuideBasis; pointDefaults: BsPointKey[]; columns: BsColumn[] | null; prevChoices: { key: string; label: string }[]; prev: BalanceTabModel["prev"]; provisional: boolean; who: string; customViews?: BsCustomViewModel[]; hiddenNote?: string }): BalanceTabModel {
  const groups = Object.fromEntries((Object.keys(BS_GROUP_LABEL) as BsGroup[]).map((k) => [k, { name: BS_GROUP_LABEL[k], short: BS_GROUP_SHORT[k] }])) as BalanceTabModel["groups"];
  const { customViews, ...rest } = o;
  return { ...rest, guideBasis: o.guideBasis ?? "living", groups, pointChoices: BS_POINT_CHOICES, customViews: customViews ?? [] };
}
