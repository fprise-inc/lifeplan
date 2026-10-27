// 表の最後の年の標準（本人・配偶者のうち若い方が100歳になる年。子は含めない）: 新しい世帯で家族を足していったとき、
// アプリの見本の世帯を開いたとき（元のモデル世帯は表の長さがまちまち）、資産と負債のタブ・結果のタブの年の範囲
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { BalanceTab } from "../src/presentation/BalanceTab.tsx";
import { DEMO_HOUSEHOLDS } from "../src/workspace/catalog.ts";
import { balanceTabModel, bsPlan, DEFAULT_BS_GUIDE, DEFAULT_BS_POINTS } from "../src/workspace/balanceTab.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, sampleRequest, standardEndYear, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { endYearNotice } from "../src/workspace/input/stages/assumptions.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { displayYears } from "../src/workspace/present.ts";
import { modelHousehold, preview } from "./helpers.ts";

const fieldOf = (wh: WorkingHousehold, stage: "family" | "assumptions", key: string): FieldDef => {
  const f = allFields(buildStage(stage, wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const ids = (prefix: string) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};
const newest = (wh: WorkingHousehold) => wh.request.input.household.members.at(-1)!;

describe("新しい世帯の表の最後の年", () => {
  it("本人30歳・配偶者29歳・0歳の子: 若い方の大人（配偶者）が100歳になる年。子の100歳ではない", () => {
    const id = ids("m");
    let wh = blankHousehold("2026-10", id);
    const self = wh.request.input.household.members[0]!;
    wh = fieldOf(wh, "family", `family/${self.id}/birth`).set(wh, "1996-05");
    expect(wh.request.input.endYear).toBe(2096);
    wh = addMember(wh, "spouse", id);
    wh = fieldOf(wh, "family", `family/${newest(wh).id}/birth`).set(wh, "1997-01");
    expect(wh.request.input.endYear).toBe(2097);
    wh = addMember(wh, "child", id);
    wh = fieldOf(wh, "family", `family/${newest(wh).id}/birth`).set(wh, "2026-08");
    expect(wh.request.input.endYear).toBe(2097);
    expect(standardEndYear(wh.request.input.household)).toBe(2097);
    // 推定（標準の値）の印のまま
    expect(fieldStatus(fieldOf(wh, "assumptions", "assume/endYear"), wh).status).toBe("estimated");
  });

  it("単身なら本人が100歳になる年", () => {
    let wh = blankHousehold("2026-10", ids("s"));
    const self = wh.request.input.household.members[0]!;
    wh = fieldOf(wh, "family", `family/${self.id}/birth`).set(wh, "1999-06");
    expect(wh.request.input.endYear).toBe(2099);
  });
});

describe("アプリの見本の世帯を開いたとき", () => {
  it("どの見本も、表の最後の年を標準にそろえる（元のモデル世帯は変えない）", () => {
    for (const d of DEMO_HOUSEHOLDS) {
      const raw = modelHousehold(d.id);
      const before = raw.input.endYear;
      const opened = sampleRequest(raw);
      expect(opened.input.endYear, d.id).toBe(standardEndYear(raw.input.household));
      expect(raw.input.endYear, d.id).toBe(before);
      const wh = fromRequest(opened);
      expect(fieldStatus(fieldOf(wh, "assumptions", "assume/endYear"), wh).status, d.id).toBe("estimated");
      expect(endYearNotice(wh), d.id).toBeNull();
    }
  });

  it("100年分の見本（本人30歳の夫婦と0歳の子）は 2125年（本人129歳）でなく 2097年（奥様100歳）まで", () => {
    const raw = modelHousehold("lifetime100Plan");
    expect(raw.input.endYear).toBe(2125);
    const req = sampleRequest(raw);
    expect(req.input.endYear).toBe(2097);
    expect(displayYears(req).at(-1)).toBe(2097);
    const p = bsPlan({ key: "A", letter: "A", name: "プランA", title: "現状", base: true, req, table: preview(req).table });
    // 資産と負債のタブの年のつまみ: 今（2026年・本人30歳）から表の最後の年（2097年・本人101歳）まで
    expect(p.years[0]).toMatchObject({ year: 2026, age: 30 });
    expect(p.years.at(-1)).toMatchObject({ year: 2097, age: 101 });
    expect(p.years.at(-1)!.members).toBe("ご主人101歳・奥様100歳");
    expect(p.years.some((y) => y.year > 2097)).toBe(false);
    const model = balanceTabModel({ plans: [p], selected: "A", base: "A", guide: DEFAULT_BS_GUIDE, pointDefaults: DEFAULT_BS_POINTS, columns: null, prevChoices: [], prev: { status: "idle", model: null }, provisional: false, who: "ご主人" });
    const html = renderToString(h(BalanceTab, { model, band: null, onPrev: () => undefined, onGuide: () => undefined, onColumns: () => undefined, onPointDefaults: () => undefined }));
    const i = html.indexOf("data-bs-range");
    const input = html.slice(html.lastIndexOf("<input", i), html.indexOf(">", i));
    expect(input).toContain(`max="${p.years.length - 1}"`);
    // 目盛りの右の端は表の最後の年の年齢（101歳）。129歳などは出ない
    const scale = html.slice(html.indexOf("yb-scale"), html.indexOf("</div>", html.indexOf("yb-scale")));
    expect(scale).toContain("101歳");
    expect(scale).not.toMatch(/1(0[2-9]|[1-2]\d)歳/);
  });
});
