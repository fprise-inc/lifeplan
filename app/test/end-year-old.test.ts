// 表の最後の年の年齢の数え方と、表が今年より前に終わる世帯（0169）:
// - 「○歳になる年」は、表の年齢の行・年齢の欄と同じく、その年の12月末に○歳の年（生まれ年＋年齢）。1月1日生まれも同じ年
// - 若い方がすでにその年齢に近い・過ぎている（101歳以上など）ときは、表を少なくとも5年分にする（計算エンジンが endYear で止まらない）
// - 今の入力で計算できなかったプランは、前の計算の残りの結果で「足りる」「残ります」を出さない
import { describe, expect, it } from "vitest";
import { ALL_ROWS, forEngine } from "../src/engine/moneyRows.ts";
import { bigMoneyOf } from "../src/workspace/bigMoney.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, endAgeOf, endYearForAge, endYearRuleOf, mutate, standardEndYear, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { bandModel, CURRENT, planLetters } from "../src/workspace/plans/band.ts";
import { displayYears, toPresentation } from "../src/workspace/present.ts";
import { ageInYear } from "../src/workspace/roles.ts";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { modelHousehold, preview } from "./helpers.ts";

const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(buildStage("assumptions", wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
/** 本人だけの世帯（計算基準月 2026-11）。生年月を変え、表の最後の年を標準にそろえる */
const single = (birthYearMonth: string, bornOnFirst = false): WorkingHousehold =>
  mutate(blankHousehold("2026-11"), (h, req) => {
    const self = h.members[0]!;
    self.birth = { birthYearMonth, bornOnFirst };
    req.input.endYear = standardEndYear(h, req.input.baseMonth);
  });

describe("「○歳になる年」は生まれ年＋年齢（H8-002）", () => {
  it("1月1日生まれでも、100歳まで → 100歳の年。選び方・年齢の欄・表の年齢の行が同じ年と年齢", () => {
    for (const bornOnFirst of [true, false]) {
      const wh = single("1990-01", bornOnFirst);
      const h = wh.request.input.household;
      const self = h.members[0]!;
      const y = endYearForAge(h, 100);
      expect(y).toBe(2090);
      expect(ageInYear(self, y)).toBe(100);
      expect(endAgeOf(h, y)).toBe(100);
      expect(wh.request.input.endYear).toBe(2090);
      // 表を何歳まで見るかの欄は「ご本人が100歳まで（既定）」で、欄の下も100歳の年
      const f = fieldOf(wh, "assume/endYear");
      expect(f.get(wh).value).toBe("default");
      expect(f.kind === "select" ? f.options.find((o) => o.value === "default")?.label : "").toBe("ご本人が100歳まで（既定）");
      expect(f.get(wh).hint).toContain("100歳の年");
      expect(endYearRuleOf(wh)).toEqual({ kind: "default" });
      // 「年で決める…」で同じ年を入れても同じ年（決め方は年で決めた年）
      const byYear = f.set(wh, "year");
      const typed = fieldOf(byYear, "assume/endYear/year").set(byYear, 2090);
      expect(typed.request.input.endYear).toBe(2090);
      expect(endYearRuleOf(typed)).toEqual({ kind: "year" });
    }
  });
});

describe("若い方がすでにその年齢を過ぎている世帯（H6-008）", () => {
  it("101歳以上・100歳ちょうど: 表の最後の年は今年より後で、表は5年分。計算エンジンが止まらない", () => {
    for (const birth of ["1921-01", "1920-11", "1899-01", "1926-10", "1926-12"]) {
      const wh = single(birth);
      const req = wh.request;
      expect(req.input.endYear, birth).toBe(2031);
      expect(displayYears(req), birth).toEqual([2027, 2028, 2029, 2030, 2031]);
      expect(() => preview(req), birth).not.toThrow();
      // 表を何歳まで見るかの欄は既定のまま（ほかの年齢も同じ年になるが、既定を見せる）
      expect(fieldOf(wh, "assume/endYear").get(wh).value, birth).toBe("default");
    }
  });

  it("表がもともと5年分以上ある世帯は変わらない（96歳は5年分、90歳は100歳の年）", () => {
    expect(single("1930-06").request.input.endYear).toBe(2031);
    expect(single("1936-06").request.input.endYear).toBe(2036);
  });

  it("「年で決める…」の年の欄の下限は表の最初の年（計算基準月が年の途中なら翌年。表が0年にならない）。人と年齢の選択肢はどれも5年分の表", () => {
    const wh = single("1921-01");
    const minOf = (f: FieldDef) => (f.kind === "int" ? f.min : null);
    const f = fieldOf(wh, "assume/endYear");
    const byYear = f.set(wh, "year");
    expect(minOf(fieldOf(byYear, "assume/endYear/year"))).toBe(2027);
    for (const o of f.kind === "select" ? f.options.filter((x) => x.value !== "year") : []) expect(f.set(wh, o.value).request.input.endYear, o.label).toBe(2031);
  });
});

describe("計算できなかったプランに「足りる」「残ります」を出さない（H6-008）", () => {
  const req = modelHousehold("pensionCouple");
  const res = preview(req);
  it("区画「夢と予定」の一行の結論は出さない（並べる物とチェックはそのまま）、結論の1文は計算できなかった旨", () => {
    const raw = modelHousehold("sampleFamilyDreams");
    const fe = forEngine(raw);
    const r = preview(fe);
    const input = { raw, view: ALL_ROWS };
    const same = { selected: "現状", base: "現状", same: true };
    const ok = bigMoneyOf(raw, r.table, input);
    expect(ok.line).not.toBeNull();
    const ng = bigMoneyOf(raw, r.table, input, true);
    expect(ng.line).toBeNull();
    expect(ng.groups).toEqual(ok.groups);
    const p = toPresentation({ base: raw, proposal: fe, current: r, proposed: r, targetAge: 90, selectedYear: null, provisional: false, names: same, failed: true });
    expect(p.result.parts.map((x) => x.text).join("")).toBe("今の入力では計算できませんでした");
    expect(p.verdict.parts.map((x) => x.text).join("")).not.toContain("足り");
  });
  it("プランの札は「計算できません」（前の計算の残りで「○歳まで足りる」にしない）", () => {
    const band = bandModel({ req, slots: [CURRENT], letters: planLetters([]), results: new Map([[CURRENT, res]]), modified: new Set(), base: CURRENT, selected: CURRENT, settings: DEFAULT_DISPLAY_SETTINGS, colors: new Map(), failed: new Set([CURRENT]) });
    expect(band.cards[0]?.status).toBe("計算できません");
    expect(band.cards[0]?.shortAge).toBeUndefined();
    const ok = bandModel({ req, slots: [CURRENT], letters: planLetters([]), results: new Map([[CURRENT, res]]), modified: new Set(), base: CURRENT, selected: CURRENT, settings: DEFAULT_DISPLAY_SETTINGS, colors: new Map() });
    expect(ok.cards[0]?.status).toMatch(/歳まで足りる|歳で不足/);
  });
});
