// 相続税の試算の次の回（0250）: 遺産の分け方の欄（先に亡くなる人・配偶者の割合・子ごとの割合）、土地を取得する子の欄（一次・二次）、
// 二次の時点の家族の手がかり、目安の要求に一次と二次の推移を足す（入力項目の中だけ）、推移の見せ方、外した人の片付け。
// 相続税も試算しない世帯の入力と要求は変えない
import { describe, expect, it } from "vitest";
import type { PreviewResult } from "../src/engine/types.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { divisionText, secondaryFamilyNote, setDetailed } from "../src/workspace/input/inheritanceLand.ts";
import { cheapestAt, inheritanceRequest, inheritanceView, timelineView, timelineYears } from "../src/workspace/input/inheritanceLine.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { removeMember } from "../src/workspace/input/stages/family.ts";
import { modelHousehold, preview } from "./helpers.ts";

const stage = (wh: WorkingHousehold): StageDef => buildStage("inheritance", wh);
const keys = (wh: WorkingHousehold): string[] => allFields(stage(wh)).map((f) => f.key);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stage(wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
};
const estimate = (wh: WorkingHousehold, timeline = true): PreviewResult => preview(forEngine(inheritanceRequest(wh.request, { timeline })));

const plain = fromRequest(modelHousehold("salariedCoupleTwoKids"));
const h = plain.request.input.household;
const self = h.members.find((m) => m.kind === "self")!;
const spouse = h.members.find((m) => m.kind === "spouse")!;
const [c1, c2] = h.members.filter((m) => m.kind === "child");
const home = h.residences!.find((r) => r.kind === "own")!;
const on = setDetailed(plain, true);

describe("相続税も試算しない世帯は入力も要求も変わらない", () => {
  it("分け方・取得する子の欄は出ない。目安の要求に推移を足さない", () => {
    expect(keys(plain).filter((k) => k.startsWith("inherit/division/"))).toEqual([]);
    const req = inheritanceRequest(plain.request, { timeline: true });
    expect(req.input.inheritanceTax?.timeline).toBeUndefined();
    expect(estimate(plain).inheritanceTax?.timeline).toBeUndefined();
  });

  it("試算する世帯でも、入力項目の外（ホームの要約・結果のタブのポイント）の要求には推移を足さない", () => {
    expect(inheritanceRequest(on.request).input.inheritanceTax?.timeline).toBeUndefined();
    expect(inheritanceRequest(on.request, { timeline: true }).input.inheritanceTax?.timeline?.alternatives?.map((a) => a.key)).toEqual(["legal", "spouseAll", "spouseLandsOnly"]);
  });
});

describe("遺産の分け方の欄（相続税も試算する世帯だけ）", () => {
  it("夫婦で子が2人: 先に亡くなる人・配偶者の割合・子ごとの割合が、不動産の前のまとまり「遺産の分け方」に並ぶ", () => {
    const sec = stage(on).sections.find((s) => s.key === "inherit/detail")!;
    const g = sec.groups.find((x) => x.key === "inherit/division")!;
    expect(g.title).toBe("遺産の分け方");
    expect(g.fields.map((f) => f.key)).toEqual(["inherit/division/first", "inherit/division/spouse", `inherit/division/share/${c1!.id}`, `inherit/division/share/${c2!.id}`]);
  });

  it("配偶者の割合・子の割合は division に書き、空にすると欄ごと消す", () => {
    const a = fieldOf(on, "inherit/division/spouse").set(on, "0.7");
    expect(a.request.input.inheritanceTax?.division).toEqual({ spouseShare: "0.7" });
    const b = fieldOf(a, `inherit/division/share/${c1!.id}`).set(a, "0.6");
    expect(b.request.input.inheritanceTax?.division).toEqual({ spouseShare: "0.7", shares: [{ member: c1!.id, share: "0.6" }] });
    expect(divisionText(b)).toContain("配偶者 70%");
    const c0 = fieldOf(b, "inherit/division/spouse").set(b, null);
    const c = fieldOf(c0, `inherit/division/share/${c1!.id}`).set(c0, null);
    expect(c.request.input.inheritanceTax?.division).toBeUndefined();
    // 時点の無い設定なので毎回の計算の要求には入らない（0061）
    expect(forEngine(b.request).input.inheritanceTax).toBeUndefined();
  });

  it("先に亡くなる人を選ぶと、後に亡くなる人（lastSurvivor）にもう一人を書く。空にすると年上の人が先（省略）", () => {
    const f = fieldOf(on, "inherit/division/first");
    expect(f.get(on)).toEqual({ value: self.id, implicit: true });
    const w = f.set(on, spouse.id);
    expect(w.request.input.inheritanceTax?.lastSurvivor).toBe(self.id);
    expect(fieldOf(w, "inherit/division/first").get(w).value).toBe(spouse.id);
    expect(fieldOf(w, "inherit/division/first").set(w, null).request.input.inheritanceTax?.lastSurvivor).toBeUndefined();
  });

  it("配偶者のほかの人を選んだ土地には「取得する子」が出て、member に書く。配偶者に戻すと子を外す", () => {
    const k = `inherit/land/${home.id}`;
    const a = fieldOf(on, `${k}/primary/acquirer`).set(on, "cohabiting");
    expect(keys(a)).toContain(`${k}/primary/member`);
    const b = fieldOf(a, `${k}/primary/member`).set(a, c2!.id);
    expect(b.request.input.inheritanceTax?.lands?.[0]?.primary).toEqual({ acquirer: "cohabiting", member: c2!.id });
    const met = fieldOf(b, `${k}/primary/met`).set(b, true);
    expect(met.request.input.inheritanceTax?.lands?.[0]?.primary).toEqual({ acquirer: "cohabiting", member: c2!.id, met: true });
    const back = fieldOf(met, `${k}/primary/acquirer`).set(met, "spouse");
    expect(back.request.input.inheritanceTax?.lands?.[0]?.primary).toEqual({ acquirer: "spouse", met: true });
    expect(keys(back)).not.toContain(`${k}/primary/member`);
  });

  it("二次の取得する人の説明に、二次の時点の家族（独立する見込み・同居の見込み）を書く", () => {
    const note = secondaryFamilyNote(on);
    expect(note).toContain(`二次の時点（${String(on.request.input.endYear)}年）`);
    expect(note).toContain("2035年に独立する見込み");
    const f = fieldOf(on, `inherit/land/${home.id}/secondary/acquirer`);
    expect(f.help).toContain("選ぶまでは二次で特例を使いません");
    expect(f.help).toContain("2038年に独立する見込み");
  });

  it("外した子の割合と、土地を取得する子を片付ける（取得する人の種類は残す）", () => {
    let w = fieldOf(on, "inherit/division/spouse").set(on, "0.5");
    w = fieldOf(w, `inherit/division/share/${c2!.id}`).set(w, "0.8");
    w = fieldOf(w, `inherit/land/${home.id}/secondary/acquirer`).set(w, "cohabiting");
    w = fieldOf(w, `inherit/land/${home.id}/secondary/member`).set(w, c2!.id);
    const out = removeMember(w, c2!.id);
    expect(out.request.input.inheritanceTax?.division).toEqual({ spouseShare: "0.5" });
    expect(out.request.input.inheritanceTax?.lands?.[0]?.secondary).toEqual({ acquirer: "cohabiting" });
  });
});

describe("一次と二次の推移の見せ方", () => {
  const withHome = fieldOf(on, `inherit/land/${home.id}/area`).set(on, "150");
  it("入力項目の目安の計算に推移が入り、計算基準年から表の最後の年まで毎年。表は5年ごとと最初・最後の年", () => {
    const r = estimate(withHome);
    const v = timelineView(withHome, r)!;
    expect(v).not.toBeNull();
    expect(v.lead).toContain("が先にその年に亡くなり");
    const base = Number(withHome.request.input.baseMonth.slice(0, 4));
    expect(v.rows[0]?.year).toBe(base);
    expect(v.rows.at(-1)?.year).toBe(withHome.request.input.endYear);
    const shown = timelineYears(v.rows, false);
    expect(shown[0]?.year).toBe(base);
    expect(shown.at(-1)?.year).toBe(withHome.request.input.endYear);
    expect(shown.every((x, i) => i === 0 || i === shown.length - 1 || (x.year - base) % 5 === 0)).toBe(true);
    expect(timelineYears(v.rows, true)).toHaveLength(v.rows.length);
    // 分け方を入れていなければ、入れた分け方＝法定相続分どおりなので、法定相続分の行は重ねて出さない
    expect(v.series.map((s) => s.key)).toEqual(["entered", "spouseAll", "spouseLandsOnly"]);
    expect(v.series[0]?.label).toBe("法定相続分どおり");
    // 計算基準年の一次は「いまご本人が亡くなったら」と同じ額
    const now = r.inheritanceTax?.points.find((p) => p.point === "now" && p.decedent === self.id);
    expect(v.rows[0]?.primary).toBe(now?.payable);
    const best = cheapestAt(v, base)!;
    expect(v.series.some((s) => s.label === best.label)).toBe(true);
  });

  it("分け方を入れると、比較に法定相続分の行が出て、内訳は「入れた分け方で」", () => {
    const w = fieldOf(withHome, "inherit/division/spouse").set(withHome, "0.8");
    const r = estimate(w);
    const v = timelineView(w, r)!;
    expect(v.series.map((s) => s.key)).toEqual(["entered", "legal", "spouseAll", "spouseLandsOnly"]);
    expect(v.series[0]?.label).toBe("入れた分け方（配偶者 80%）");
    const now = inheritanceView(w, r).points.find((p) => p.title.startsWith("いま"))!;
    expect(now.details.join("\n")).toMatch(/入れた分け方（配偶者 80%）で分けたとして|人ごと: /);
  });

  it("相次相続控除を推移の二次に入れたことを、含めていない一覧の言葉に書く", () => {
    const r = estimate(withHome);
    expect(inheritanceView(withHome, r).notIncluded).toContain("相次相続控除（一次と二次の推移の二次には入れています）");
    expect(inheritanceView(withHome, estimate(withHome, false)).notIncluded).toContain("相次相続控除");
  });
});
