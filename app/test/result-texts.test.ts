// 結果の画面の文の差し替え（0212・0016 の 2026-11-13 の追記）: 結論の1文・取り崩しの条件・グラフの注・ポイント・万一のときの結論の1文を
// 説明の一覧（result:…）に載せ、承認した事務所の文に計算した値を差し込んで出す。公式の文は今までと同じ（取り崩しの条件の言い方の直しを除く）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { PreviewResult, TableCell } from "../src/engine/types.ts";
import { ContingencyVerdict } from "../src/presentation/ContingencyView.tsx";
import { ResultVerdictView } from "../src/presentation/MainView.tsx";
import type { ContingencyModel, ProtectionChartModel } from "../src/presentation/model.ts";
import { DonutCard, InvestBar } from "../src/workspace/invest/InvestBar.tsx";
import { bandOf, drawdownText, investVerdict, stressLines } from "../src/workspace/invest/present.ts";
import { officeTextsFrom, type OfficeTextEntry } from "../src/workspace/office/customTexts.ts";
import { displayYears, resultVerdict } from "../src/workspace/present.ts";
import { OFFICIAL_WORDING, RESULT_TEXTS, resultOfficialText, wordingOf } from "../src/workspace/resultTexts.ts";
import { roles } from "../src/workspace/roles.ts";
import { insights } from "../src/workspace/tools/fpTools.ts";
import { buildTextsCatalog } from "../scripts/textsCatalog.ts";
import { modelHousehold } from "./helpers.ts";

const office = (id: string, op: OfficeTextEntry["do"], text: string | null, official?: string): OfficeTextEntry => {
  const d = RESULT_TEXTS.find((x) => x.id === id);
  if (d === undefined) throw new Error(id);
  return {
    id,
    do: op,
    text,
    official: official ?? resultOfficialText(d),
    officialChanged: false,
  };
};
const join = (parts: { text: string }[]) => parts.map((p) => p.text).join("");
const marks = (s: string) => [...s.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1] as string);

describe("結果の画面の文の一覧（result:…）", () => {
  const cat = buildTextsCatalog();
  const results = cat.entries.filter((e) => e.kind === "result");

  it("表の文がすべて一覧に載る（お客さまと一緒に見る文。書き換えるだけで、消せるのはグラフの注だけ）", () => {
    expect(results.map((e) => e.id).sort()).toEqual(RESULT_TEXTS.map((d) => d.id).sort());
    expect(cat.summary.results).toBe(RESULT_TEXTS.length);
    expect(RESULT_TEXTS.length).toBeGreaterThanOrEqual(25);
    for (const e of results) {
      expect(e.id).toMatch(/^result:(main|invest|contingency)\/[a-zA-Z]+$/);
      expect(e.audience).toBe("customer");
      expect(e.ops.includes("append")).toBe(false);
      expect(e.ops[0]).toBe("replace");
    }
    const hideable = results.filter((e) => e.ops.includes("hide")).map((e) => e.id);
    expect(hideable.sort()).toEqual(["result:invest/donutHint", "result:invest/donutPinned", "result:invest/stressNote"]);
  });

  it("公式の文の印は vars とちょうど同じ。計算の値の入る印（numberVars）は vars の中。字の { } は無い", () => {
    for (const d of RESULT_TEXTS) {
      const text = resultOfficialText(d);
      expect(new Set(marks(text)), d.id).toEqual(new Set(Object.keys(d.vars)));
      for (const v of d.numberVars) expect(Object.keys(d.vars), d.id).toContain(v);
      expect(text.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, ""), d.id).not.toMatch(/[{}]/);
      for (const help of Object.values(d.vars)) expect(help.length, d.id).toBeGreaterThan(2);
    }
    const e = results.find((x) => x.id === "result:invest/verdict")!;
    expect(e.text).toBe("{plan}では、金融資産は {age} まで持ちます");
    expect(e.numberVars).toEqual(["age"]);
    expect(e.varsHelp?.["age"]).toContain("84歳");
  });

  it("新しい画面の言葉の決まり（比較・入力項目。「比べ」「カード」「札」「見通し」を使わない）", () => {
    for (const d of RESULT_TEXTS) {
      const all = [resultOfficialText(d), d.where, ...Object.values(d.vars)].join("\n");
      for (const w of ["比べ", "カード", "札", "見通し"]) expect(all, d.id).not.toContain(w);
    }
  });
});

describe("公式の文（今までと同じ。取り崩しの条件の言い方だけ直した）", () => {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self");

  it("結果のタブの結論の1文と2行目", () => {
    const same = resultVerdict({ selected: "プランA", base: "プランA", same: true }, self, 2060, null, 100);
    expect(same.parts).toEqual([{ text: "プランA（基準）", strong: true }, { text: "：" }, { text: expect.stringMatching(/^\d+歳で資産が尽きます$/), strong: true }]);
    const v = resultVerdict({ selected: "プランB", base: "プランA", same: false }, self, null, 2060, 100);
    expect(join(v.parts)).toBe("プランBは100歳まで足ります");
    expect(v.parts.map((p) => p.strong === true)).toEqual([true, false, true]);
    expect(join(v.sub)).toMatch(/^プランA（基準）は\d+歳で資産が尽きます$/);
    expect(join(resultVerdict({ selected: "プランB", base: "プランA", same: false }, self, null, null, null).parts)).toBe("プランBは最後まで足ります");
  });

  it("取り崩しの条件: 予定が無いときは「取り崩しの予定を入れず、足りない年だけ取り崩す場合」（前は「足りない年だけ取り崩す場合（取り崩しの予定なし）」）", () => {
    const none = structuredClone(req);
    delete none.input.assumptions?.investment?.drawdown;
    expect(drawdownText(none)).toBe("取り崩しの予定を入れず、足りない年だけ取り崩す場合");
    expect(drawdownText(none)).not.toContain("（取り崩しの予定なし）");
    const years = displayYears(none);
    const ages = years.map((y) => (self === undefined ? null : y - Number(self.member.birth.birthYearMonth.slice(0, 4))));
    expect(bandOf(none, ages)?.holdSub).toMatch(/^\d+歳〜（足りない年だけ取り崩す）$/);
  });
});

describe("承認した事務所の文を当てる", () => {
  const req = modelHousehold("salariedCoupleTwoKids");
  const years = [2080, 2081];
  const table = (v: number): TableCell[] => [
    { row: "cf.balance.financial", year: 2080, amount: 100 },
    { row: "cf.balance.financial", year: 2081, amount: v },
  ];

  it("資産の推移の結論の1文: 事務所の文に、同じ計算の値を差し込む。公式の文で太字だった印の値は太字のまま", () => {
    const w = wordingOf(
      officeTextsFrom([
        office("result:invest/verdict", "replace", "{plan}の場合、金融資産が続くのは {age} までです"),
        office("result:invest/verdictBase", "replace", "基準の{basePlan}は{baseAge}まで"),
        office("result:invest/conditionNone", "replace", "毎年の不足だけを金融資産から使うとき"),
      ]),
    );
    const none = structuredClone(req);
    delete none.input.assumptions?.investment?.drawdown;
    const v = investVerdict({ selected: "プランC", base: "プランA", same: false }, { req: none, table: table(5) }, { req: none, table: table(-5) }, years, w);
    const official = investVerdict({ selected: "プランC", base: "プランA", same: false }, { req: none, table: table(5) }, { req: none, table: table(-5) }, years);
    const age = official.parts.find((p) => p.strong === true)!.text;
    expect(v.parts).toEqual([{ text: "プランCの場合、金融資産が続くのは " }, { text: age, strong: true }, { text: " までです" }]);
    expect(join(v.sub)).toMatch(/^毎年の不足だけを金融資産から使うとき／基準のプランAは\d+歳まで$/);
    expect(v.tone).toBe(official.tone);
    // 承認したときの公式の文が今の公式の文と違えば当てない（アプリの更新で公式の文が変わったときは、本体が止めるか知らせる）
    const stale = wordingOf(officeTextsFrom([office("result:invest/verdict", "replace", "{plan}は {age} まで", "{plan}は {age} まで持つ")]));
    expect(join(investVerdict({ selected: "プランC", base: "プランA", same: false }, { req, table: table(5) }, null, years, stale).parts)).toBe(join(official.parts));
  });

  it("文は字のまま出す（HTML として読まない）。差し込む値も印として読み直さない", () => {
    const w = wordingOf(officeTextsFrom([office("result:main/verdict", "replace", "<b>{plan}</b>は{status}")]));
    const v = resultVerdict({ selected: "{age}", base: "プランA", same: false }, undefined, null, null, 100, w);
    const html = renderToString(h(ResultVerdictView, { model: v }));
    expect(html).toContain("&lt;b>");
    expect(html).not.toContain("<b><b>");
    expect(join(v.parts)).toBe("<b>{age}</b>は100歳まで足ります");
  });

  it("結論の1文の部品の文も、それぞれ事務所の文になる（「○歳まで足ります」など）", () => {
    const w = wordingOf(officeTextsFrom([office("result:main/lasts", "replace", "{age}まで資金は足りる見込みです"), office("result:main/verdictBase", "replace", "（基準の{basePlan}: {baseStatus}）")]));
    const v = resultVerdict({ selected: "プランB", base: "プランA", same: false }, undefined, null, null, 95, w);
    expect(join(v.parts)).toBe("プランBは95歳まで資金は足りる見込みです");
    expect(join(v.sub)).toBe("（基準のプランA: 95歳まで資金は足りる見込みです）");
  });

  it("グラフの注は消せる。結論の1文は消す行があっても消さない", () => {
    const w = wordingOf(officeTextsFrom([office("result:invest/donutHint", "hide", null), office("result:invest/stressNote", "replace", "目安です"), office("result:main/runsOut", "hide", null)]));
    expect(w.note("result:invest/donutHint")).toBeNull();
    expect(w.note("result:invest/donutPinned")).toBe("グラフで固定した年の内訳です（もう一度押すと外れます）");
    expect(w.text("result:main/runsOut", { age: "80歳" })).toBe("80歳で資産が尽きます");
    expect(
      renderToString(
        h(DonutCard, {
          panes: [],
          by: "account",
          onBy: () => undefined,
          note: w.note("result:invest/donutHint"),
        }),
      ),
    ).not.toContain("donut-note");
    const inv = {
      breakdown: null,
      band: null,
      stress: [],
      view: { breakdown: false, band: false, stressHidden: [] },
    };
    const bar = (stressNote?: string | null) =>
      renderToString(
        h(InvestBar, {
          invest: inv,
          canBreakdown: false,
          onBreakdown: () => undefined,
          onPeriods: () => undefined,
          stressOn: true,
          onStress: () => undefined,
          onStressLine: () => undefined,
          ...(stressNote !== undefined ? { stressNote } : {}),
        }),
      );
    expect(bar()).toContain("行き過ぎた予測ではなく");
    expect(bar(w.note("result:invest/stressNote"))).toContain("目安です");
    expect(bar(null)).not.toContain('class="note"');
  });

  it("相場が下がった場合の線の「○歳まで持つ」・運用の期間の帯", () => {
    const w = wordingOf(officeTextsFrom([office("result:invest/stressLasts", "replace", "{age}まで"), office("result:invest/holdNone", "replace", "{age}から、不足の年だけ取り崩す")]));
    const r = { table: table(-5) } as unknown as PreviewResult;
    expect(stressLines(req, { drop: r }, years, w)[0]!.lasts).toMatch(/^\d+歳まで$/);
    const none = structuredClone(req);
    delete none.input.assumptions?.investment?.drawdown;
    const ys = displayYears(none);
    expect(
      bandOf(
        none,
        ys.map((_, i) => 40 + i),
        w,
      )?.holdSub,
    ).toMatch(/^\d+歳から、不足の年だけ取り崩す$/);
  });

  it("ポイント: 事務所の文に年・額を差し込む", () => {
    const w = wordingOf(officeTextsFrom([office("result:main/pointInheritanceTax", "replace", "相続税は{amount}ほどかかりそうです")]));
    const list = insights(req, { header: {} as never, table: [], summary: null }, { inheritanceTax: 3200000, wording: w });
    expect(list[0]!.text).toBe("相続税は320万円ほどかかりそうです");
    expect(insights(req, { header: {} as never, table: [], summary: null }, { inheritanceTax: 3200000 })[0]!.text).toBe("いま亡くなったときの相続税の目安は320万円です（相続・贈与の項目）");
  });

  it("万一のときの必要保障額の結論の1文（作業の層が文を当てて、提示層は部品を描くだけ）", () => {
    const prot: ProtectionChartModel = {
      key: "self",
      title: "ご本人が亡くなった場合",
      sub: "末子の独立までの資金",
      years: [2030],
      ages: [40],
      axis: [],
      need: [0],
      needWithAssets: [0],
      coverage: [0],
      maxShort: { year: 2030, amount: 12000000 },
      verdict: wordingOf(officeTextsFrom([office("result:contingency/protectionShort", "replace", "{event}は、{year}に最大{amount}の保障が足りません")])).parts("result:contingency/protectionShort", {
        event: "ご本人が亡くなった場合",
        amount: "1,200万円",
        year: "2030年",
      }),
      reformFrom: null,
      insights: [],
    };
    const model = {
      protection: { status: "ready", charts: [prot], error: null, ms: 1 },
      scenarios: [{ key: "death:self", protection: "self" }],
      selected: "death:self",
      scenario: { status: "loading", model: null, error: null, stale: false },
    } as unknown as ContingencyModel;
    const html = renderToString(h(ContingencyVerdict, { model, mode: "protection" }));
    expect(html).toContain("ご本人が亡くなった場合は、");
    expect(html).toContain("<b>2030年</b>");
    expect(html).toContain("<b>1,200万円</b>");
    expect(
      OFFICIAL_WORDING.text("result:contingency/protectionEnough", {
        event: "ご本人が亡くなった場合",
      }),
    ).toBe("ご本人が亡くなった場合、保障は足りています");
  });
});
