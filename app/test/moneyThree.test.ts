// お金の3つの分け方（説明用の図。0032）の提示用の値: 3つの箱の中身の一覧（同じ形）・まとめ・文（事実だけ）・呼び方・今の置き場所。
// 計算そのもの（足し算・マイナス・期間の端）は engine/test/moneyThree.test.ts
import { renderToString } from "preact-render-to-string";
import { h } from "preact";
import { describe, expect, it } from "vitest";
import type { EngineRequest, TableCell } from "../src/engine/types.ts";
import { MoneyThreeCards, MoneyThreeNotice, MoneyThreeSection } from "../src/presentation/MoneyThree.tsx";
import type { MoneyThreeModel } from "../src/presentation/model.ts";
import { DEFAULT_MONEY_THREE, MONEY_THREE_LIST_MAX, moneyThreeModel, placementOf, readMoneyThree } from "../src/workspace/moneyThree.ts";
import { modelHousehold, preview } from "./helpers.ts";

const MAN = 10_000;
const allText = (m: MoneyThreeModel) => JSON.stringify(m);

/** 架空の表（2026年1月から。毎年: 手取り 500万円・ふだんの支出 384万円 → 収入の残り 116万円） */
function synthetic(o: { deposit: number; nisa?: number; pooled?: number; events: [number, number][] }): { req: EngineRequest; table: TableCell[] } {
  const req = modelHousehold("educationTwoKids");
  req.input.baseMonth = "2026-01";
  req.input.endYear = 2070;
  req.input.household.goals = [];
  req.input.household.cars = [];
  req.input.household.periodicExpenses = [];
  req.input.household.accounts = o.pooled !== undefined ? [{ id: "00000000-0000-4000-8000-0000000000f1", kind: "pooled", owner: req.input.household.members[0]!.id, uninvested: 200 * MAN }] : [];
  const t: TableCell[] = [];
  for (let y = 2026; y <= 2070; y++) {
    t.push({ row: "cf.income.salary", year: y, amount: 600 * MAN }, { row: "cf.taxSi.pension", year: y, amount: 100 * MAN }, { row: "cf.expense.living", year: y, amount: 300 * MAN }, { row: "cf.expense.housing.rent", year: y, amount: 60 * MAN }, { row: "cf.expense.insurance.life", year: y, amount: 24 * MAN });
  }
  for (const [y, a] of o.events) t.push({ row: "cf.expense.lumpSum.other", year: y, amount: a });
  t.push({ row: "cf.balance.account.deposit", year: 2026, amount: o.deposit });
  if (o.nisa !== undefined) t.push({ row: "cf.balance.account.nisa", year: 2026, amount: o.nisa });
  if (o.pooled !== undefined) t.push({ row: "cf.balance.account.pooled", year: 2026, amount: o.pooled });
  return { req, table: t };
}

describe("お金の3つの分け方の提示用の値（0032）", () => {
  it("モデル世帯: 3つの箱の額の合計が金融資産（増やすお金がプラスのとき）、貯めるお金の一覧は賄えない分だけ", () => {
    const req = modelHousehold("dualAssetsTwoKids");
    const r = preview(req);
    const m = moneyThreeModel({ req, table: r.table, settings: DEFAULT_MONEY_THREE });
    const [s, v, g] = m.boxes;
    expect(m.names).toEqual(["使うお金", "貯めるお金", "増やすお金"]);
    if (g.amount > 0) expect(s.amount + v.amount + g.amount).toBe(m.place.total);
    // 一覧の各行は賄えない分（0 の年は出さない）。まとめと合わせて貯めるお金になる
    expect(v.items.every((x) => x.amount > 0)).toBe(true);
    expect(v.items.reduce((a, x) => a + x.amount, 0) + (v.rest?.amount ?? 0)).toBe(v.amount);
    expect(v.items.length + (v.rest !== null ? 1 : 0)).toBeLessThanOrEqual(MONEY_THREE_LIST_MAX);
    // 全部の表は「内訳を見る」の中（賄えない分が 0 の年も入る）
    expect(m.table.length).toBeGreaterThanOrEqual(v.items.length);
    // 使うお金の中身（ふだんの支出の中身の月額）と、増やすお金の引き算
    expect(s.formula).toMatch(/^ふだんの支出 月[\d,]+万円 × 6か月$/);
    expect(s.items.map((x) => x.label)).toContain("基本生活費");
    expect(s.items.every((x) => x.per === "月")).toBe(true);
    expect(g.items.map((x) => `${x.lead}${x.label}`)).toEqual(["金融資産", "−使うお金", "−貯めるお金"]);
    // 今の置き場所は資産と負債のタブの「今」（計算基準年の年末）の金融資産
    const fin = r.table.filter((c) => c.row === "cf.balance.financial" && c.year === m.year).reduce((a, c) => a + c.amount, 0);
    expect(m.place.total).toBe(fin);
  });

  it("できごとが多いときは、大きい順に上から出して「ほか○件」にまとめる。収入で賄える年は一覧に出さずにひと言", () => {
    const events: [number, number][] = [
      [2027, 200 * MAN],
      [2028, 50 * MAN], // 賄える（0）
      [2029, 300 * MAN],
      [2030, 150 * MAN],
      [2031, 400 * MAN],
      [2032, 130 * MAN],
      [2033, 250 * MAN],
      [2034, 180 * MAN],
      [2035, 500 * MAN],
    ];
    const { req, table } = synthetic({ deposit: 1000 * MAN, events });
    const m = moneyThreeModel({ req, table, settings: DEFAULT_MONEY_THREE });
    const v = m.boxes[1];
    expect(v.items).toHaveLength(MONEY_THREE_LIST_MAX - 1);
    expect(v.items.map((x) => Number(x.lead))).toEqual([2027, 2029, 2031, 2033, 2035]);
    expect(v.rest).toEqual({ count: 3, amount: (34 + 14 + 64) * MAN });
    expect(v.note).toBe("収入で賄える年は入れていません。");
    expect(m.table).toHaveLength(9);
    expect(m.table.find((x) => x.year === 2028)?.uncovered).toBe(0);
  });

  it("預金のまま・足りない・ほぼ同じの文は事実だけ（勧める言葉は書かない）。ほぼ同じのときは結果のタブに知らせを出さない", () => {
    const events: [number, number][] = [[2027, 300 * MAN]];
    // 使う 192 ＋ 貯める 184 ＝ 376万円
    const over = moneyThreeModel({ ...synthetic({ deposit: 1000 * MAN, nisa: 500 * MAN, events }), settings: DEFAULT_MONEY_THREE });
    expect(over.status).toBe("over");
    expect(over.say.head.map((p) => p.text).join("")).toBe("「増やすお金」1,124万円のうち、624万円 が預金のままです。");
    expect(over.notice?.map((p) => p.text).join("")).toBe("「増やすお金」のうち 624万円 が預金のままです");
    const short = moneyThreeModel({ ...synthetic({ deposit: 100 * MAN, nisa: 500 * MAN, events }), settings: DEFAULT_MONEY_THREE });
    expect(short.status).toBe("short");
    expect(short.say.head.map((p) => p.text).join("")).toBe("預金だけでは、「使うお金」と「貯めるお金」の分が 276万円 足りません。");
    expect(short.say.sub.map((p) => p.text).join("")).toBe("この2つの分の範囲に、NISA 276万円 が入っています。");
    const even = moneyThreeModel({ ...synthetic({ deposit: 390 * MAN, nisa: 500 * MAN, events }), settings: DEFAULT_MONEY_THREE });
    expect(even.status).toBe("even");
    expect(even.notice).toBeNull();
    const neg = moneyThreeModel({ ...synthetic({ deposit: 100 * MAN, nisa: 100 * MAN, events }), settings: DEFAULT_MONEY_THREE });
    expect(neg.boxes[2].amount).toBe(0);
    expect(neg.boxes[2].note).toBe("「使うお金」と「貯めるお金」が金融資産より176万円多いので、0 としています。");
    expect(neg.say.sub.map((p) => p.text).join("")).toContain("金融資産の合計（200万円）でも 176万円 足りません。");
    for (const m of [over, short, even, neg]) expect(allText(m)).not.toMatch(/しましょう|おすすめ|お勧め|べき|運用して|最後まで足りる|案/);
  });

  it("呼び方を「すぐ使う・近いうちに使う・しばらく使わない」に変えられる。何か月・何年は欄の値", () => {
    const { req, table } = synthetic({ deposit: 1000 * MAN, events: [[2027, 300 * MAN]] });
    const m = moneyThreeModel({ req, table, settings: { months: 3, years: 5, wording: "time" } });
    expect(m.names).toEqual(["すぐ使うお金", "近いうちに使うお金", "しばらく使わないお金"]);
    expect(m.boxes[0].amount).toBe(96 * MAN);
    expect(m.range).toBe("2027〜2031年");
    expect(m.say.head.map((p) => p.text).join("")).toContain("「しばらく使わないお金」");
    expect(readMoneyThree({ months: 25, years: 0, wording: "x" })).toEqual(DEFAULT_MONEY_THREE);
  });

  it("まとめた金融資産の運用しない分は、預金などに数える", () => {
    const { req, table } = synthetic({ deposit: 100 * MAN, pooled: 900 * MAN, events: [] });
    const lines = placementOf(req, table);
    expect(lines.map((l) => [l.key, l.amount, l.liquid])).toEqual([
      ["deposit", 100 * MAN, true],
      ["pooledCash", 200 * MAN, true],
      ["pooled", 700 * MAN, false],
    ]);
    expect(moneyThreeModel({ req, table, settings: DEFAULT_MONEY_THREE }).place.liquidName).toBe("預金など");
  });

  it("画面: 3枚のカードは同じ形（名前と額・中身の一文・いつも見える一覧）で、全部の表は「内訳を見る」の中。知らせは区画へ移るボタンつき", () => {
    const events: [number, number][] = [[2027, 300 * MAN], [2029, 400 * MAN]];
    const m = moneyThreeModel({ ...synthetic({ deposit: 100 * MAN, nisa: 900 * MAN, events }), settings: DEFAULT_MONEY_THREE });
    const html = renderToString(h(MoneyThreeCards, { model: m, edit: () => {} }));
    for (const k of ["spend", "save", "grow"]) expect(html).toContain(`data-m3-items="${k}"`);
    // 貯めるお金の一覧は details の外（いつも見える）
    const save = html.slice(html.indexOf('data-m3-box="save"'), html.indexOf('data-m3-box="grow"'));
    expect(save.indexOf('data-m3-items="save"')).toBeLessThan(save.indexOf("<details"));
    expect(save).toContain("2027");
    expect(save).toContain("内訳を見る");
    expect(html).toContain('data-m3-step="months"');
    // 持ち帰り用（欄なし）は文で書く
    const ro = renderToString(h(MoneyThreeCards, { model: m }));
    expect(ro).not.toContain("data-m3-step");
    expect(ro).toContain("ふだんの支出 月32万円 × 6か月");
    expect(renderToString(h(MoneyThreeNotice, { model: m, onGo: () => {} }))).toContain("資産と負債で見る →");
    expect(renderToString(h(MoneyThreeSection, { model: m, onSettings: () => {} }))).toContain("説明用の図です。キャッシュフロー表・結果の計算には混ぜません");
  });
});
