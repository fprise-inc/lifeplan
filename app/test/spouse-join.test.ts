// 結婚の予定（これから加わる配偶者）: 加わる前の年は、表・グラフ・年を指したときの札・資産と負債・根拠・予定の見出しに配偶者の年齢を出さない。
// 加わる年（加わる月が年の途中でも）から出す（年齢は各年12月末の年齢。抜ける年まで出すのと同じ数え方）
import { describe, expect, it } from "vitest";
import type { EngineRequest } from "../src/engine/types.ts";
import { bsPlan } from "../src/workspace/balanceTab.ts";
import { buildEvidence } from "../src/workspace/evidence.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { yearLabel } from "../src/workspace/input/schedule.ts";
import { cashflowTable, displayYears, familyText, toPresentation } from "../src/workspace/present.ts";
import { ageInYear, roles } from "../src/workspace/roles.ts";
import { full, modelHousehold, preview } from "./helpers.ts";

/** 共働きの夫婦の見本を、配偶者が計算基準の年の3年後の4月に加わる（結婚の予定）形にする */
function marriagePlan(): { req: EngineRequest; by: number; join: number } {
  const req = modelHousehold("dualNoKids");
  const by = Number(req.input.baseMonth.slice(0, 4));
  req.input.endYear = by + 10;
  const h = req.input.household;
  const join = by + 3;
  const sp = h.members.find((m) => m.kind === "spouse")!;
  Object.assign(sp, { joins: { at: `${join}-04` }, expected: true });
  const rel = (h.relations ?? []).find((r) => r.type === "spouse")!;
  Object.assign(rel, { from: { at: `${join}-04` } });
  return { req, by, join };
}

describe("結婚の予定の配偶者の年齢", () => {
  const { req, by, join } = marriagePlan();
  const res = preview(req);
  const years = displayYears(req);
  const spouse = roles(req).find((r) => r.key === "spouse")!;

  it("表の年齢の行: 加わる前の年は空、加わる年から年齢", () => {
    const row = cashflowTable(req, res.table, years, "表").rows.find((r) => r.key === "age:spouse") as { ages: (number | null)[] };
    years.forEach((y, i) => expect(row.ages[i]).toBe(y < join ? null : ageInYear(spouse.member, y)));
  });

  it("グラフの年齢の段と年を指したときの札: 加わる前の年は出さない", () => {
    const m = toPresentation({ base: req, proposal: req, current: res, proposed: res, targetAge: 95, selectedYear: by, provisional: false });
    const axis = m.chart.axis.find((r) => r.label === "配偶者")!;
    years.forEach((y, i) => {
      expect(axis.ages[i]).toBe(y < join ? null : ageInYear(spouse.member, y));
      expect(m.chart.family[i]!.includes("配偶者")).toBe(y >= join);
    });
    expect(familyText(roles(req), join - 1)).not.toContain("配偶者");
    expect(familyText(roles(req), join)).toContain(`配偶者${ageInYear(spouse.member, join)}歳`);
  });

  it("資産と負債・根拠・予定の見出し: 加わる前の年は配偶者の年齢を出さない", () => {
    const p = bsPlan({ key: "A", letter: "A", name: "プランA", title: "現状", base: true, req, table: res.table });
    for (const y of p.years) expect(y.members.includes("配偶者")).toBe(y.year >= join);
    const ev = buildEvidence(full(req), req, "financial", by + 1)!;
    expect(ev.context).not.toContain("配偶者");
    expect(buildEvidence(full(req), req, "financial", join)!.context).toContain("配偶者");
    const wh = fromRequest(req);
    expect(yearLabel(wh, by + 1)).not.toContain("配偶者");
    expect(yearLabel(wh, join)).toContain(`配偶者${ageInYear(spouse.member, join)}歳`);
  });

  it("最初から世帯にいる配偶者（加わる時点が空）は今までどおり毎年出す", () => {
    const r = modelHousehold("dualNoKids");
    r.input.endYear = by + 10;
    const ys = displayYears(r);
    const row = cashflowTable(r, preview(r).table, ys, "表").rows.find((x) => x.key === "age:spouse") as { ages: (number | null)[] };
    expect(row.ages.every((a) => a !== null)).toBe(true);
  });
});
