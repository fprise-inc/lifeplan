// 外した物を指す欄の片付け（0163）: 人・働き方の期間・持ち家・口座などを「外す」と、外した物を指す欄が残らないこと、
// 残ったときに計算が止まらず、黙って無視しないで計算の知らせ（入力が足りない）に出ること
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { noticeRows } from "../src/workspace/engineNotices.ts";
import { allFields, type ActionDef, type StageId } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { danglingRefs, keepRefs, refSites, SCHEMA_REF_FIELDS } from "../src/workspace/input/refs.ts";
import { buildStage, STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

type Obj = Record<string, unknown>;

const open = (id: string): WorkingHousehold => {
  const demo = demoHousehold(id);
  const req = modelHousehold(id);
  const self = req.input.household.members.find((m) => m.kind === "self")!;
  return fromRequest(req, demo?.reemployment !== undefined ? { postRetirement: { [self.id]: { ...demo.reemployment, type: demo.reemployment.type as "contract" } } } : {});
};
const actionsOf = (w: WorkingHousehold, stage: StageId): ActionDef[] => buildStage(stage, w).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
const input = (w: WorkingHousehold) => w.request.input as unknown as Obj;
const run = (w: WorkingHousehold) => preview(forEngine(w.request));
const sumRow = (w: WorkingHousehold, row: string) => (run(w).table as { row: string; amount: number }[]).filter((c) => c.row === row).reduce((s, c) => s + c.amount, 0);
/** 外す前から指す先の無い欄（見本の世帯に残っている物）を除いた、指す先の無い欄 */
const newDangling = (before: WorkingHousehold, after: WorkingHousehold) => {
  const old = new Set(danglingRefs(input(before)).map((s) => `${s.item}|${s.id}`));
  return danglingRefs(input(after)).filter((s) => !old.has(`${s.item}|${s.id}`));
};

describe("H3-003 死亡保険金の受取人になっている配偶者を外す", () => {
  for (const id of ["rentalSample", "dualAssetsTwoKids"])
    it(`${id}: 外しても計算が止まらず、受取人の行も外れる（残りの受取人で割合を分け直す）`, () => {
      const wh = open(id);
      const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
      expect(JSON.stringify(wh.request.input.household.insuranceContracts)).toContain(spouse.id);
      const rm = actionsOf(wh, "family").find((a) => a.key === `family/${spouse.id}/remove`)!;
      const w1 = rm.run(wh);
      expect(JSON.stringify(w1.request.input.household.insuranceContracts ?? [])).not.toContain(spouse.id);
      expect(() => run(w1)).not.toThrow();
      expect(newDangling(wh, w1)).toEqual([]);
      for (const c of w1.request.input.household.insuranceContracts ?? []) {
        const total = (c.beneficiaries ?? []).reduce((s, b) => s + Number(b.share), 0);
        if ((c.beneficiaries ?? []).length > 0) expect(total).toBeCloseTo(1, 6);
      }
    });

  it("pairLoan: 夫婦の共有の持ち家から配偶者を外すと、名義と持分はご本人が100%（住宅ローン控除の持分も）", () => {
    const wh = open("pairLoan");
    const h = wh.request.input.household;
    const self = h.members.find((m) => m.kind === "self")!;
    const spouse = h.members.find((m) => m.kind === "spouse")!;
    expect(JSON.stringify(h.residences)).toContain(spouse.id);
    const w1 = actionsOf(wh, "family").find((a) => a.key === `family/${spouse.id}/remove`)!.run(wh);
    const h1 = w1.request.input.household;
    for (const r of (h1.residences ?? []).filter((x) => x.ownership !== undefined)) expect(r.ownership).toEqual([{ member: self.id, share: "1" }]);
    for (const d of h1.debts ?? []) if (d.housing?.ownership !== undefined) expect(d.housing.ownership).toEqual([{ member: self.id, share: "1" }]);
    expect(newDangling(wh, w1)).toEqual([]);
    expect(() => run(w1)).not.toThrow();
  });
});

describe("H3-004 働き方の期間を外すと、その勤め先の退職金が知らせなしに消える", () => {
  const wh = open("salariedCoupleTwoKids");
  const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
  const lump = (w: WorkingHousehold) => sumRow(w, "cf.income.lumpSum.retirement");
  const period = (wh.request.input.household.employmentPeriods ?? []).find((p) => p.member === self.id)!;
  const removed = actionsOf(wh, "work").find((a) => a.key === `work/period/${period.id}/remove`)!.run(wh);

  it("外しただけ（勤め先が指す先の無いまま）でも、計算の知らせ（入力が足りない）と、受け取る時期の未入力の印が出る", () => {
    expect(lump(wh)).toBe(18_000_000);
    expect(lump(removed)).toBe(0);
    const notes = noticeRows(removed, [{ label: "現状", result: run(removed) }]);
    const lines = notes.filter((n) => n.kind === "input" && n.card === "retirement").map((n) => n.text);
    expect(lines.join("\n")).toContain("受け取る時期");
    const b = removed.request.input.household.retirementBenefits![0]!;
    const paidAt = allFields(buildStage("retirement", removed)).find((f) => f.key.endsWith("/paidAt") && f.key.includes(b.id))!;
    expect(fieldStatus(paidAt, removed).status).toBe("missing");
  });

  it("入力のパネルの片付け（keepRefs）で勤め先を空にし、「正社員」で足し直すと、足した期間を勤め先にして退職金が入る", () => {
    const w1 = keepRefs(wh, removed);
    const b1 = w1.request.input.household.retirementBenefits![0]!;
    expect(b1.employment).toBeUndefined();
    expect(newDangling(wh, w1)).toEqual([]);
    const w2 = actionsOf(w1, "work").find((a) => a.key === `work/${self.id}/start` && a.label === "正社員")!.run(w1);
    const ids = new Set((w2.request.input.household.employmentPeriods ?? []).map((p) => p.id));
    const b2 = w2.request.input.household.retirementBenefits!.find((b) => b.id === b1.id)!;
    expect(ids.has(b2.employment as string)).toBe(true);
    expect(lump(w2)).toBe(18_000_000);
  });

  it("外したままでも（片付けの前の世帯でも）、足し直せば足した期間を勤め先にする", () => {
    const w2 = actionsOf(removed, "work").find((a) => a.key === `work/${self.id}/start` && a.label === "正社員")!.run(removed);
    const ids = new Set((w2.request.input.household.employmentPeriods ?? []).map((p) => p.id));
    expect(ids.has(w2.request.input.household.retirementBenefits![0]!.employment as string)).toBe(true);
    expect(lump(w2)).toBe(18_000_000);
  });
});

describe("持ち家を外すと、住宅ローンの住まいの欄を空にする（ローンは残す）", () => {
  it("salariedCoupleTwoKids: 外した家を指す住宅ローンが残らない", () => {
    const wh = open("salariedCoupleTwoKids");
    const r = (wh.request.input.household.residences ?? []).find((x) => (wh.request.input.household.debts ?? []).some((d) => d.housing?.residence === x.id))!;
    const raw = actionsOf(wh, "housing").find((a) => a.key === `housing/res/${r.id}/remove`)!.run(wh);
    // 操作の中では片付けない（プランを直すときの連鎖の確かめで、一緒に外すかを選ぶため）
    expect(newDangling(wh, raw).map((s) => s.item)).toEqual(["debt.housing.residence"]);
    const w1 = keepRefs(wh, raw);
    expect(newDangling(wh, w1)).toEqual([]);
    expect((w1.request.input.household.debts ?? []).length).toBe((wh.request.input.household.debts ?? []).length);
  });
});

// 見張り: 見本の全世帯で、どの入力項目の「外す」（とほかのボタン）を押しても、入力のパネルの片付けの後に指す先の無い欄が増えない。
// 操作だけ（片付けの前）でも、人を指す欄は残らない（計算が止まらない）
const HOUSEHOLDS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));
const ENGINE_RUN = new Set(["salariedCoupleTwoKids", "rentalSample", "pairLoan", "dualAssetsTwoKids", "sampleParentsCare", "elderCare", "sampleExecutive", "sampleSelfEmployedFamily", "housingGiftFromParents", "insuranceMaturityAnnuity", "parentalLeave", "investmentCouple"]);

describe("見張り: 外したあとに、外した物を指す欄が残らない", () => {
  for (const id of HOUSEHOLDS)
    it(id, { timeout: 600_000 }, () => {
      const wh = open(id);
      const bad: string[] = [];
      for (const { id: stage } of STAGE_ORDER) {
        for (const a of actionsOf(wh, stage)) {
          if (a.danger !== true) continue;
          let raw: WorkingHousehold;
          try {
            raw = a.run(wh);
          } catch {
            continue;
          }
          const member = newDangling(wh, raw).filter((s) => s.target === "member" || s.target === "donor");
          if (member.length > 0) bad.push(`${a.key}（操作だけ）: ${member.map((s) => s.item).join(", ")}`);
          const settled = keepRefs(wh, raw);
          const left = newDangling(wh, settled);
          if (left.length > 0) bad.push(`${a.key}: ${left.map((s) => s.item).join(", ")}`);
          if (ENGINE_RUN.has(id))
            try {
              run(settled);
            } catch (e) {
              bad.push(`${a.key}: 計算が止まる ${String(e).slice(0, 120)}`);
            }
        }
      }
      expect(bad.join("\n")).toBe("");
    });
});

describe("指す先の無い欄が残っても、計算は黙って無視しない（計算の知らせ）", () => {
  const unknown = "00000000-0000-4000-8000-00000000dead";
  it("退職金の勤め先・不動産の借入の不動産・支払いのつながる物が指す先の無いとき、入力が足りない知らせを出す", () => {
    const wh = open("salariedCoupleTwoKids");
    const req = structuredClone(wh.request) as EngineRequest;
    const h = req.input.household;
    h.retirementBenefits![0]!.employment = unknown;
    const r = preview(forEngine(req));
    const codes = (r.header.notices as { code: string; ids: string[] }[]).filter((n) => n.code === "N_INPUT_REQUIRED").map((n) => n.ids.join(","));
    expect(codes.some((c) => c.includes("reference.retirementBenefit.employment"))).toBe(true);
    const lines = noticeRows({ ...wh, request: req }, [{ label: "現状", result: r }]);
    const ref = lines.find((n) => n.text.includes("外した物"));
    expect(ref?.kind).toBe("input");
    expect(ref?.card).toBe("retirement");
  });
});

describe("物の ID を指す欄の一覧（refs.ts）は、エンジンの入力のスキーマで ID を指す欄を全部数えている", () => {
  it("スキーマの ID を指す欄（id の欄を除く）は、片付けの一覧か、外す操作が無い欄の一覧のどちらかにある", () => {
    const s = JSON.parse(readFileSync(join(REPO_DIR, "engine", "schemas", "engine.input.json"), "utf8")) as Obj;
    const found = new Set<string>();
    const isUuid = (n: unknown) => typeof n === "object" && n !== null && String((n as Obj).$ref ?? "").endsWith("/uuid");
    const walk = (n: unknown, path: string) => {
      if (Array.isArray(n)) return n.forEach((x) => walk(x, path));
      if (typeof n !== "object" || n === null) return;
      const o = n as Obj;
      if (isUuid(o) && !path.endsWith(".id")) found.add(path);
      if (o.type === "array" && isUuid(o.items)) found.add(`${path}[]`);
      for (const [k, v] of Object.entries(o)) {
        if (k === "properties") for (const [pk, pv] of Object.entries(v as Obj)) walk(pv, `${path}.${pk}`);
        else if (k === "items") walk(v, `${path}[]`);
        else if (k === "$defs") for (const [dk, dv] of Object.entries(v as Obj)) walk(dv, `#${dk}`);
        else if (typeof v === "object") walk(v, path);
      }
    };
    walk(s, "");
    expect([...found].sort()).toEqual([...SCHEMA_REF_FIELDS].sort());
  });

  it("見本の世帯で、指す欄の一覧が拾った欄の名前は、どれもスキーマの欄に当たる", () => {
    const items = new Set<string>();
    for (const id of HOUSEHOLDS) for (const site of refSites(input(open(id)))) items.add(site.item);
    expect(items.size).toBeGreaterThan(10);
  });
});
