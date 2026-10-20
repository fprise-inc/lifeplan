// 資産と負債のタブ（家計のバランスシート）の提示用の値を作る（作業の層。0016 の2・0025・0027）。
// - 分け方は提案書と同じ部品（report/src/bsGroups.ts）: 資産を「すぐ使えるお金・値動きのある運用・引き出せないお金・換金しにくい資産」に、
//   負債を「住宅ローン・その他の負債（資金の不足を含む）」に分ける。資産の合計＝負債の合計＋純資産。
// - 年は計算基準年（今。入力した値から出した事実）から表の最後の年まで。先の年は見込み。
// - ひと言の解説・箱の説明・この年の出来事もここで作る（提示層は受け取った文を出すだけ）。物の ID・FP のメモは渡さない
import type { EngineRequest, TableCell } from "../engine/types.ts";
import { bsSeries, BS_GROUP_LABEL, BS_GROUP_SHORT, groupTotal, type BsAt, type BsGroup } from "../../../report/src/index.ts";
import type { BalanceTabModel, BsGroupKey, BsGuide, BsMarkKind, BsPlanModel, BsPrevModel, BsYearModel, VerdictPart } from "../presentation/model.ts";
import { man } from "../presentation/format.ts";
import { addMonths, ageReachedMonth, parseYm, readLevers } from "./levers.ts";
import { depletionYear, eventsOf } from "./present.ts";
import { ageInYear, roles, type Role } from "./roles.ts";

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
  return { months: pair(o.months, d.months, 120), risk: pair(o.risk, d.risk, 100), debt };
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

/** その年の世帯の年齢の文（ご主人・奥様だけ。例: 「ご主人45歳・奥様43歳」） */
function membersText(rs: readonly Role[], year: number): string {
  return rs
    .filter((r) => r.key === "self" || r.key === "spouse")
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
  const at: BsAt[] = bsSeries(p.table, years, { residences: h.residences ?? [], debts: (h.debts ?? []).map((d) => ({ id: d.id, kind: d.kind })) });
  const living = byYear(p.table, years, (c) => under(c.row, "cf.expense.living") && c.row !== "cf.expense.living.drawdown");
  const loanPay = byYear(p.table, years, (c) => c.row === "cf.expense.housing.loan");
  const prepay = byYear(p.table, years, (c) => c.row === "cf.expense.housing.loan.prepayment");
  const retireLump = byYear(p.table, years, (c) => under(c.row, "cf.income.lumpSum.retirement") || under(c.row, "cf.income.lumpSum.db"));
  const dcLump = byYear(p.table, years, (c) => under(c.row, "cf.income.lumpSum.dc") || under(c.row, "cf.income.lumpSum.ideco") || under(c.row, "cf.income.lumpSum.smallBusiness"));
  const sale = byYear(p.table, years, (c) => under(c.row, "cf.income.lumpSum.realEstateSale"));
  // 計算基準年が年の途中から始まるとき、その年のお金の動きは数か月分しかないので、生活費と返済額は翌年（1年分）の値で見る
  if (parseYm(req.input.baseMonth).m > 1 && years.length > 1) {
    living[0] = living[1] as number;
    loanPay[0] = loanPay[1] as number;
  }
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

  const lastAge = ageOf(years.at(-1) ?? 0);
  const status = dep !== null ? { text: `${ageText(dep).replace(who, "")}で資金が不足`, ok: false } : { text: `${lastAge ?? ""}歳まで足りる`, ok: true };

  const out: BsYearModel[] = years.map((year, i) => {
    const a = at[i] as BsAt;
    const pr = at[Math.max(0, i - 1)] as BsAt;
    const a0 = at[0] as BsAt;
    const mort = g(i, "mortgage");
    const prMort = g(Math.max(0, i - 1), "mortgage");
    const liquid = g(i, "liquid");
    const events: BsYearModel["events"] = evs.filter((e) => e.year === year).map((e) => ({ kind: EVENT_KIND[e.icon] ?? "other", text: e.text }));
    if (i === negIdx) events.push({ kind: "neg", text: "純資産がマイナスに" });
    const say = sayFor({ i, a, pr, a0, at, years, ageText, mort, prMort, liquid, retireLump: retireLump[i] ?? 0, dcLump: dcLump[i] ?? 0, retired: retireYear !== null && year > retireYear, pensionStart: pensionYear !== null && year === pensionYear, depYear: dep, negIdx, sale: sale[i] ?? 0, prepay: prepay[i] ?? 0 });
    const principal = i > 0 ? Math.max(0, prMort - mort - (prepay[i] ?? 0)) : 0;
    const insight = insightFor({ i, a, pr, retired: retireYear !== null && year > retireYear, prepay: prepay[i] ?? 0, dcLump: dcLump[i] ?? 0, principal, loanPay: loanPay[i] ?? 0, sale: sale[i] ?? 0 });
    const monthly = (living[i] ?? 0) / 12;
    const notes: BsYearModel["notes"] = {
      liquid: `今日・明日にでも使えるお金です。${monthly > 0 ? `生活費（月${mn(monthly)}）の${monthsText(liquid / monthly)}。` : ""}急な出費や、収入で足りない分はまずここから出ます。`,
      market: "株や投資信託など。売ればお金になりますが、そのときの相場で金額が変わります（口座に分けずにまとめて入れた金融資産も、ここに数えています）。",
      locked: "iDeCo・企業型DC・小規模企業共済など。原則として決まった年齢（iDeCo・企業型DCは60歳）まで引き出せません。受け取ると「すぐ使えるお金」に移ります。",
      illiquid: "住んでいる家・使っている車・保険の解約返戻金など、すぐにはお金にしにくいもの。持ち家は、土地を上昇率で動かし、建物を構造の耐用年数で定額で減らして、建てたときの価値の一定の割合を下限に残した見込みです。",
      mortgage: `${(loanPay[i] ?? 0) > 0 ? `年間の返済額は${mn(loanPay[i] ?? 0)}。` : ""}${loanEnd !== null && year <= loanEnd ? `${loanEnd}年（${ageText(loanEnd)}）に返し終わる見込みです。` : ""}返済のうち元金の分は、純資産として残ります。`,
      debt: a.shortfall > 0 ? "「資金の不足」は、金融資産が尽きた後に足りない分を、借りている状態として負債に置いたものです（実際には家の売却などで補う必要があります）。" : "車のローン・奨学金など、住宅ローンのほかに借りているお金です。",
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
      events,
      say,
      insight,
      notes,
    };
  });
  return { key: p.key, letter: p.letter, name: p.name, title: p.title, base: p.base, years: out, marks, jumps, status };
}

/** 「○か月分」（2年以上は「○年分」） */
export function monthsText(m: number): string {
  if (!Number.isFinite(m)) return "";
  return m >= 24 ? `${(m / 12).toFixed(1)}年分` : `${m.toFixed(1)}か月分`;
}

interface SayIn {
  i: number;
  a: BsAt;
  pr: BsAt;
  a0: BsAt;
  at: readonly BsAt[];
  years: readonly number[];
  ageText: (y: number) => string;
  mort: number;
  prMort: number;
  liquid: number;
  retireLump: number;
  dcLump: number;
  retired: boolean;
  pensionStart: boolean;
  depYear: number | null;
  negIdx: number;
  sale: number;
  prepay: number;
}

/** 純資産が次の1,000万円の区切りを超える年 */
function crossNext(at: readonly BsAt[], years: readonly number[], i: number): { year: number; th: number } | null {
  const th = (Math.floor(Math.max(0, (at[i] as BsAt).netWorth) / 10_000_000) + 1) * 10_000_000;
  for (let k = i + 1; k < at.length; k++) if ((at[k] as BsAt).netWorth >= th) return { year: years[k] as number, th };
  return null;
}

/** ひと言の解説（年に応じて。1行目と2行目） */
function sayFor(s: SayIn): { head: VerdictPart[]; sub: VerdictPart[] } {
  const { i, a, pr, a0, ageText, years } = s;
  const nw = a.netWorth;
  const cx = crossNext(s.at, years, i);
  const cxs = cx !== null ? `${cx.year}年（${ageText(cx.year)}）に純資産が${mn(cx.th)}を超えます。` : "";
  const futNeg = s.negIdx > i ? (years[s.negIdx] as number) : null;
  const futShort = s.depYear !== null && s.depYear > years[i]! ? s.depYear : null;
  const diff0 = nw - a0.netWorth;
  const fromNow = `今より${mn(Math.abs(diff0))}${diff0 >= 0 ? "多い" : "少ない"}`;
  if (nw < 0) return { head: [plain(`資金の不足が${mn(a.shortfall)}にふくらみ、純資産がマイナス（`), strong(mn(nw)), plain("）です。")], sub: [plain("家や持ち物を全部お金に換えても、借りている分を返しきれない状態（債務超過）です。")] };
  if (a.shortfall > 0) {
    if (pr.shortfall <= 0 || i === 0) return { head: [plain(`金融資産が尽き、足りない分（資金の不足 ${mn(a.shortfall)}）が負債に積み上がり始めます。`)], sub: [plain(`純資産 ${mn(nw)} の多くは換金しにくい資産（${mn(groupTotal(a, "illiquid"))}）で、すぐには使えないお金です。`)] };
    return { head: [plain(`資金の不足が${mn(a.shortfall)}に増え、純資産は`), strong(mn(nw)), plain("に減っています。")], sub: [plain(futNeg !== null ? `このままだと${futNeg}年（${ageText(futNeg)}）に純資産がマイナスになります。` : "換金しにくい資産の分で、純資産はまだプラスを保っています。")] };
  }
  if (i === 0) {
    if (s.mort > 0) return { head: [plain(`住宅ローンの残りが${mn(s.mort)}あり、今の純資産は`), strong(mn(nw)), plain("です。")], sub: cxs !== "" ? [plain(`ローンの残りが減っていき、${cxs}`)] : [] };
    return { head: [plain("今の純資産は"), strong(mn(nw)), plain(`です（資産${mn(a.totalAssets)}・負債${mn(a.totalLiabilities)}）。`)], sub: cxs !== "" ? [plain(cxs)] : [] };
  }
  if (s.retireLump > 0 || s.dcLump > 0) {
    const what = [s.retireLump > 0 ? `退職金${mn(s.retireLump)}` : "", s.dcLump > 0 ? `iDeCo・企業型DCなど（${mn(s.dcLump)}）` : ""].filter((x) => x !== "").join("と");
    return { head: [plain(`${what}が入り、すぐ使えるお金が${mn(s.liquid)}になります${s.prepay > 0 ? "（住宅ローンを繰り上げて返した後）" : ""}。`)], sub: [plain(`純資産は${fromNow}${mn(nw)}です。`)] };
  }
  if (s.sale > 0) return { head: [plain(`家を売り、手取り${mn(s.sale)}がすぐ使えるお金に入ります。`)], sub: [plain(`換金しにくい資産が現金に変わり、純資産は${mn(nw)}です（売却の費用などの分だけ動きます）。`)] };
  if (s.prMort > 0 && s.mort <= 0) return { head: [plain(`住宅ローンを返し終わり、負債が${a.totalLiabilities <= 0 ? "なくなります" : `${mn(a.totalLiabilities)}になります`}。`)], sub: [plain("純資産は"), strong(mn(nw)), plain(`です${a.totalLiabilities <= 0 ? "（資産の合計と同じ）" : ""}。`)] };
  if (s.pensionStart) return { head: [plain("年金の受け取りが始まります。")], sub: [plain("純資産は"), strong(mn(nw)), plain("。ここから先は、年金で足りない分を金融資産から取り崩します。")] };
  if (s.retired && a.financial < pr.financial) {
    return {
      head: [plain(`収入で足りない分を取り崩し、金融資産は1年で${mn(pr.financial - a.financial)}減って${mn(a.financial)}になります。`)],
      sub: [plain(futShort !== null ? `このままだと${futShort}年（${ageText(futShort)}）に金融資産が尽きます。` : `${ageText(years.at(-1) as number)}まで金融資産は残る見込みです。`)],
    };
  }
  if (s.mort > 0) return { head: [plain(`住宅ローンの残りが${mn(s.mort)}に減り、純資産は${fromNow}`), strong(mn(nw)), plain("です。")], sub: cxs !== "" ? [plain(cxs)] : [] };
  return { head: [plain("純資産は"), strong(mn(nw)), plain(`（${fromNow}）です。`)], sub: cxs !== "" ? [plain(cxs)] : futShort !== null ? [plain(`${futShort}年（${ageText(futShort)}）に金融資産が尽きる見込みです。`)] : [] };
}

/** バランスシートで見えること（年に応じて） */
function insightFor(s: { i: number; a: BsAt; pr: BsAt; retired: boolean; prepay: number; dcLump: number; principal: number; loanPay: number; sale: number }): VerdictPart[] {
  const { i, a, pr } = s;
  if (i === 0) return [plain("今の年のバランスシートは、入力した値から出した"), strong("事実"), plain("です。先の年は"), strong("見込み"), plain("で、毎年の見直しのときに「前回と比べる」で答え合わせができます。")];
  if (s.prepay > 0) return [plain(`住宅ローンを${mn(s.prepay)}繰り上げて返すと、手元のお金は同じだけ減りますが、借りているお金も同じだけ減るので、`), strong("純資産は変わりません"), plain("。浮くのはこの先の利息です。")];
  if (s.dcLump > 0) return [plain(`iDeCo・企業型DCなど（${mn(s.dcLump)}）を受け取ると、「引き出せないお金」が「すぐ使えるお金」に移ります。`), strong("資産の合計は変わらず"), plain("、使える形に変わるだけです。")];
  if (s.sale > 0) return [plain("家を売ると、換金しにくい資産がすぐ使えるお金に変わります。"), strong("純資産が動くのは、売却の費用と評価額との差の分だけ"), plain("です。")];
  if (s.principal > 0 && s.loanPay > 0) {
    const intr = Math.max(0, s.loanPay - s.principal);
    return [plain(`ローンの返済で手元のお金は年に${mn(s.loanPay)}減りますが、借りているお金も${mn(s.principal)}減るので、`), strong("その分は純資産として残っています"), plain(`（消えるのは利息の約${mn(intr)}だけ）。キャッシュフロー表では支出にしか見えない部分です。`)];
  }
  if (a.shortfall > 0 && a.netWorth < 0) return [plain("「資金の不足」が資産の合計を上回り、"), strong("純資産がマイナス"), plain("です。家を売っても借りている分を返しきれない状態で、キャッシュフロー表の「残高のマイナス」だけでは見えにくい点です。")];
  if (a.shortfall > 0) return [plain("「資金の不足」は借りている状態として負債に積んでいます。換金しにくい資産があるので純資産はまだプラスでも、"), strong("すぐ使えるお金はありません"), plain("。")];
  if (s.retired && a.financial < pr.financial) return [plain("生活費のための取り崩しは、資産が減った分だけ"), strong("純資産も減ります"), plain("。ローンの返済（借りているお金も減る）との違いです。")];
  return [plain("純資産は「資産 − 負債」。どの年も左右の箱の高さが同じになることで、計算が合っていることが分かります。")];
}

// ---- 前回と比べる（控え）----

/** 控えの見込みの今と今の実際の差の、大きい項目（最大4つ） */
export function prevItems(expected: BsYearModel, actual: BsYearModel): string[] {
  const keys = new Map<string, { label: string; debt: boolean }>();
  for (const l of [...expected.lines, ...actual.lines]) keys.set(l.key, { label: l.label, debt: l.group === "mortgage" || l.group === "debt" });
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

export function balanceTabModel(o: { plans: BsPlanModel[]; selected: string; base: string; guide: BsGuide; prevChoices: { key: string; label: string }[]; prev: BalanceTabModel["prev"]; provisional: boolean; who: string }): BalanceTabModel {
  const groups = Object.fromEntries((Object.keys(BS_GROUP_LABEL) as BsGroup[]).map((k) => [k, { name: BS_GROUP_LABEL[k], short: BS_GROUP_SHORT[k] }])) as BalanceTabModel["groups"];
  return { ...o, groups, customViews: [] };
}
