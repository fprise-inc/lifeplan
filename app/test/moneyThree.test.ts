// お金の3つの分け方（説明用の図。0032）の提示用の値: 3つの箱の中身の一覧（同じ形）・まとめ・文（事実だけ）・呼び方・今の置き場所。
// 計算そのもの（足し算・マイナス・期間の端）は engine/test/moneyThree.test.ts
import { renderToString } from "preact-render-to-string";
import { h } from "preact";
import { describe, expect, it } from "vitest";
import type { EngineRequest, TableCell } from "../src/engine/types.ts";
import { FigTip } from "../src/presentation/FigTip.tsx";
import { MoneyThreeCards, MoneyThreeFigure, MoneyThreeSection, SavePopBody } from "../src/presentation/MoneyThree.tsx";
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

  it("預金のまま・足りない・ほぼ同じの文は事実だけ（勧める言葉は書かない）。ほぼ同じのときは差を書かない", () => {
    const events: [number, number][] = [[2027, 300 * MAN]];
    // 使う 192 ＋ 貯める 184 ＝ 376万円
    const over = moneyThreeModel({ ...synthetic({ deposit: 1000 * MAN, nisa: 500 * MAN, events }), settings: DEFAULT_MONEY_THREE });
    expect(over.status).toBe("over");
    expect(over.say.head.map((p) => p.text).join("")).toBe("「増やすお金」1,124万円のうち、624万円 が預金のままです。");
    const short = moneyThreeModel({ ...synthetic({ deposit: 100 * MAN, nisa: 500 * MAN, events }), settings: DEFAULT_MONEY_THREE });
    expect(short.status).toBe("short");
    expect(short.say.head.map((p) => p.text).join("")).toBe("預金だけでは、「使うお金」と「貯めるお金」の分が 276万円 足りません。");
    expect(short.say.sub.map((p) => p.text).join("")).toBe("この2つの分の範囲に、NISA 276万円 が入っています。");
    const even = moneyThreeModel({ ...synthetic({ deposit: 390 * MAN, nisa: 500 * MAN, events }), settings: DEFAULT_MONEY_THREE });
    expect(even.status).toBe("even");
    expect(even.say.eq).toBeNull();
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

  it("画面の貯めるお金は、一覧を最初は出さず件数と「内訳を見る」（小窓）。持ち帰り用は一覧のまま。図の箱の札も同じ一覧", () => {
    const events: [number, number][] = [[2027, 300 * MAN], [2029, 400 * MAN]];
    const m = moneyThreeModel({ ...synthetic({ deposit: 100 * MAN, nisa: 900 * MAN, events }), settings: DEFAULT_MONEY_THREE });
    const sec = renderToString(h(MoneyThreeSection, { model: m, onSettings: () => {} }));
    const save = sec.slice(sec.indexOf('data-m3-box="save"'), sec.indexOf('data-m3-box="grow"'));
    expect(save).not.toContain('data-m3-items="save"');
    expect(save).toContain("data-m3-save-open");
    expect(save).toContain("内訳を見る");
    // 小窓が開くことが分かる印（グラフを小窓で出すボタンと同じ印）と、読み上げの手がかり
    expect(save).toContain("data-pop-icon");
    expect(save).toContain('aria-haspopup="dialog"');
    expect(save).toContain('aria-expanded="false"');
    expect(save).toMatch(/の できごと 2件/);
    expect(save).not.toContain("<details");
    // 使うお金・増やすお金の一覧は出したまま
    expect(sec).toContain('data-m3-items="spend"');
    expect(sec).toContain('data-m3-items="grow"');
    // 図の貯めるお金の箱の読み上げ・札の中身（年・できごと・賄えない分）
    expect(renderToString(h(MoneyThreeFigure, { model: m }))).toContain('data-m3-fig-box="save"');
  });

  it("画面: 3枚のカードは同じ形（名前と額・中身の一文・いつも見える一覧）で、全部の表は「内訳を見る」の中。知らせは区画へ移るボタンつき", () => {
    const events: [number, number][] = [[2027, 300 * MAN], [2029, 400 * MAN]];
    const m = moneyThreeModel({ ...synthetic({ deposit: 100 * MAN, nisa: 900 * MAN, events }), settings: DEFAULT_MONEY_THREE });
    const html = renderToString(h(MoneyThreeCards, { model: m, edit: () => {} }));
    for (const k of ["spend", "save", "grow"]) expect(html).toContain(`data-m3-items="${k}"`);
    // 貯めるお金の一覧は details の外（いつも見える）
    const save = html.slice(html.indexOf('data-m3-box="save"'), html.indexOf('data-m3-box="grow"'));
    expect(save).toContain('data-m3-items="save"');
    expect(save).not.toContain("<details");
    expect(save).toContain("2027");
    // 全部の年の表は、画面と同じ「内訳を見る」の小窓（同じ印）
    expect(save).toContain("data-m3-save-open");
    expect(save).toContain("data-pop-icon");
    expect(html).toContain('data-m3-step="months"');
    // 持ち帰り用（欄なし）は文で書く
    const ro = renderToString(h(MoneyThreeCards, { model: m }));
    expect(ro).not.toContain("data-m3-step");
    expect(ro).toContain("ふだんの支出 月32万円 × 6か月");
    expect(renderToString(h(MoneyThreeSection, { model: m, onSettings: () => {} }))).toContain("説明用の図です。キャッシュフロー表・結果の計算には混ぜません");
  });
  it("貯めるお金の小窓: 最初から全部の年の表（賄えない分が 0 の年も・合計の行・収入の残りの説明）。折りたたみは無い", () => {
    // 2028 年は収入で賄える（賄えない分 0）
    const events: [number, number][] = [[2027, 300 * MAN], [2028, 1 * MAN], [2029, 400 * MAN]];
    const m = moneyThreeModel({ ...synthetic({ deposit: 100 * MAN, nisa: 900 * MAN, events }), settings: DEFAULT_MONEY_THREE });
    const pop = renderToString(h(SavePopBody, { model: m, onClose: () => {} }));
    expect(pop).not.toContain("<details");
    for (const th of ["年", "できごと", "支出", "収入の残り", "賄えない分"]) expect(pop).toContain(`>${th}</th>`);
    for (const y of m.table.map((r) => r.year)) expect(pop).toContain(`>${y}</td>`);
    expect(m.table.some((r) => r.uncovered === 0)).toBe(true);
    expect(pop).toContain('class="r z"');
    expect(pop).toContain("合計（万円）");
    expect(pop).toContain("収入の残り＝");
    expect(pop).toContain('aria-label="閉じる"');
  });
  it("図: ずれている分の斜線・点線の枠・札・左右をつなぐ点線は描かない（区画の上の一文で示す）。箱はどれもフォーカスでき、名前と金額を札で読める", () => {
    const events: [number, number][] = [[2027, 300 * MAN]];
    for (const deposit of [1000, 100]) {
      const m = moneyThreeModel({ ...synthetic({ deposit: deposit * MAN, nisa: 500 * MAN, events }), settings: DEFAULT_MONEY_THREE });
      expect(m.status).not.toBe("even");
      const fig = renderToString(h(MoneyThreeFigure, { model: m }));
      expect(fig).not.toContain("stroke-dasharray");
      expect(fig).not.toContain("<pattern");
      expect(fig).not.toContain("<circle");
      expect(fig).not.toContain("のまま");
      expect(fig).not.toContain("足りない分");
      for (const k of ["spend", "save", "grow", "p.deposit", "p.nisa"]) expect(fig).toContain(`data-m3-fig-box="${k}"`);
      expect((fig.match(/tabindex="0"/gi) ?? []).length).toBe(5);
      expect(fig).toContain(`aria-label="預金 ${deposit.toLocaleString("en-US")}万円。すぐ使えるお金（預金など）"`);
      // 区画の上の一文は残す。凡例（左＝…・右＝…・ずれている分）は出さない
      const sec = renderToString(h(MoneyThreeSection, { model: m, onSettings: () => {} }));
      expect(sec).toContain(deposit === 1000 ? "が預金のままです" : "足りません");
      for (const gone of ["ずれている", "m3-legend", "左＝", "右＝", "（説明用）", "（入力した値）"]) expect(sec).not.toContain(gone);
      // 柱の見出しは「いつ使うお金か」「今どこにあるか」
      expect(fig).toContain(">いつ使うお金か<");
      expect(fig).toContain(">今どこにあるか<");
    }
  });

  it("図: 箱に書ききれない名前と金額は、画面では札で見る（図の下の一覧は持ち帰り用のレポートだけ）", () => {
    const m = moneyThreeModel({ ...synthetic({ deposit: 1000 * MAN, nisa: 4 * MAN, events: [] }), settings: DEFAULT_MONEY_THREE });
    const screen = renderToString(h(MoneyThreeFigure, { model: m }));
    const take = renderToString(h(MoneyThreeFigure, { model: m, list: true }));
    expect(screen).toContain('data-m3-fig-box="p.nisa"');
    expect(screen).not.toContain(">NISA<");
    expect(take).toContain(">NISA<");
  });

  it("札: 名前・金額・一言の補足（年の札と同じ見た目）。内訳があれば並べる", () => {
    const html = renderToString(h(FigTip, { d: { key: "p.nisa", title: "NISA", amount: 4 * MAN, note: "値動きのある運用", x: 50, y: 20, side: "r" }, W: 200, H: 100 }));
    expect(html).toContain("year-tip fig-tip");
    expect(html).toContain("NISA");
    expect(html).toContain("4<small>万円</small>");
    expect(html).toContain("値動きのある運用");
    expect(html).toMatch(/left: ?25\.000%/);
    expect(html).toContain('aria-hidden="true"');
    const rows = renderToString(h(FigTip, { d: { key: "g.liquid", title: "すぐ使えるお金", amount: 120 * MAN, rows: [{ label: "預金", amount: 100 * MAN }, { label: "外貨預金", amount: 20 * MAN }], x: 150, y: 20, side: "l" }, W: 200, H: 100 }));
    expect(rows).toContain("外貨預金");
    expect(rows).toMatch(/translate\(-100%, ?-50%\)/);
  });
});
