// 既定の値で埋まる欄（defaultMark.ts）を確定にしたら、その値を世帯に書く（0041「確定は明示の操作だけ」・0150 の打った確定）。
// 前は確定の行だけを書き、値は省略のままだったので、既定の元（前提条件の不動産の評価・取得の年月）を直すと、確定の印のまま値がついていった
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Account } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageId } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { dropStaleRows } from "../src/workspace/input/rows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, availableOps, confirmAll, fieldAddress, fieldStatus, typeValue } from "../src/workspace/input/valueState.ts";
import { readAt } from "../src/workspace/store/readings.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

/** 入力のパネルの始末（値が変わった所の行を外す） */
const panel = (before: WorkingHousehold, next: WorkingHousehold) => (next === before ? next : dropStaleRows(before, next));
const rentalField = (wh: WorkingHousehold, suffix: string): FieldDef => allFields(buildStage("rental", wh)).find((f) => f.key.endsWith(suffix))!;
const premiseField = (wh: WorkingHousehold, key: string): FieldDef => allFields(buildStage("assumptions", wh)).find((f) => f.key === key)!;
const property = (wh: WorkingHousehold) => (wh.request.input.household.accounts ?? []).find((a) => a.kind === "realEstate" && a.property !== undefined)!.property!;
const editProperty = (wh: WorkingHousehold, fn: (p: NonNullable<Account["property"]>) => void) =>
  mutate(wh, (h) => {
    const a = (h.accounts ?? []).find((x) => x.kind === "realEstate" && x.property !== undefined)!;
    fn(a.property!);
  });

/** 見本の区分マンションから、建った年・売却の費用を外して既定の値で埋まる形にする（売る予定は足す） */
function blankRental(): WorkingHousehold {
  return editProperty(fromRequest(modelHousehold("sampleSeniorRental")), (p) => {
    delete p.builtYear;
    p.sale = { at: { at: "2040-03" } } as NonNullable<typeof p.sale>;
  });
}

const HOW = {
  "この値にする": (f: FieldDef, wh: WorkingHousehold) => applyStateOp(wh, f, "confirm"),
  "同じ値を打つ": (f: FieldDef, wh: WorkingHousehold) => typeValue(f, wh, f.get(wh).value),
  "推定の値をまとめて使う": (f: FieldDef, wh: WorkingHousehold) => confirmAll(wh, [f]).wh,
} as const;

describe("既定の値で埋まる欄を確定にしたら、その値を書く", () => {
  for (const [how, run] of Object.entries(HOW)) {
    it(`土地の割合（前提条件の目安）: ${how} → 前提条件の土地の割合を直しても、物件の土地の割合は確定した 30% のまま`, () => {
      const wh0 = blankRental();
      const f = rentalField(wh0, "/landShare");
      expect(fieldStatus(f, wh0).status).toBe("estimated");
      expect(f.get(wh0).value).toBe("0.3");
      const done = panel(wh0, run(f, wh0));
      expect(fieldStatus(rentalField(done, "/landShare"), done).status).toBe("confirmed");
      expect(property(done).landShare).toBe("0.3");
      const premise = premiseField(done, "assume/realEstate/landShare");
      const moved = panel(done, premise.set(done, "0.5"));
      expect(moved.request.input.assumptions?.realEstateValuation?.landShare).toBe("0.5");
      const after = rentalField(moved, "/landShare");
      expect(after.get(moved).value).toBe("0.3");
      expect(fieldStatus(after, moved).status).toBe("confirmed");
    });

    it(`建物が建った年（取得の年）: ${how} → 取得の年月を直しても、建った年は確定した 2010年のまま`, () => {
      const wh0 = blankRental();
      const f = rentalField(wh0, "/builtYear");
      expect(fieldStatus(f, wh0).status).toBe("estimated");
      expect(f.get(wh0).value).toBe(2010);
      const done = panel(wh0, run(f, wh0));
      expect(property(done).builtYear).toBe(2010);
      const acq = rentalField(done, "/acqAt");
      const moved = panel(done, acq.set(done, "2020-04"));
      expect(property(moved).acquisition?.at).toBe("2020-04");
      const after = rentalField(moved, "/builtYear");
      expect(after.get(moved).value).toBe(2010);
      expect(fieldStatus(after, moved).status).toBe("confirmed");
    });

    it(`売却の費用（前提条件の目安）: ${how} → 前提条件の売却の費用を直しても、物件の売却の費用は確定した値のまま`, () => {
      const wh0 = blankRental();
      const f = rentalField(wh0, "/saleCost");
      expect(fieldStatus(f, wh0).status).toBe("estimated");
      const v = f.get(wh0).value;
      const done = panel(wh0, run(f, wh0));
      expect(property(done).sale?.costRate).toBe(v);
      const moved = panel(done, premiseField(done, "assume/realEstate/saleCost").set(done, "0.06"));
      const after = rentalField(moved, "/saleCost");
      expect(after.get(moved).value).toBe(v);
      expect(fieldStatus(after, moved).status).toBe("confirmed");
    });
  }

  it("欄を空にすると、書いた値を外して既定の値（推定）に戻る", () => {
    const wh0 = blankRental();
    const f = rentalField(wh0, "/landShare");
    const done = panel(wh0, applyStateOp(wh0, f, "confirm"));
    const back = panel(done, rentalField(done, "/landShare").set(done, null));
    expect(property(back).landShare).toBeUndefined();
    expect(fieldStatus(rentalField(back, "/landShare"), back).status).toBe("estimated");
  });
});

const STAGES: StageId[] = ["family", "work", "retirement", "pension", "living", "education", "housing", "insurance", "savings", "rental", "events", "car", "care", "inheritance", "fee", "assumptions"];

describe("どの欄も、推定を確定にしたら見せている値を世帯に持つ（見本の棚の全部の世帯・全部の入力項目）", () => {
  it("値の箱でない推定の欄で「この値にする」を押すと、欄の当て先に値が入る", () => {
    const names = readdirSync(join(REPO_DIR, "data", "modelHouseholds")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
    const households = [...names.map((n) => ({ n, wh: fromRequest(modelHousehold(n)) })), { n: "建った年・売却の費用が空の物件", wh: blankRental() }];
    const missing: string[] = [];
    let checked = 0;
    for (const { n, wh } of households) {
      for (const s of STAGES) {
        for (const f of allFields(buildStage(s, wh))) {
          if (f.boxed !== undefined) continue;
          const st = fieldStatus(f, wh);
          if (st.status !== "estimated" || !availableOps(f, wh, st).includes("confirm")) continue;
          const a = fieldAddress(f, wh);
          if (a === null) continue;
          const after = applyStateOp(wh, f, "confirm");
          checked++;
          if (readAt(after.request.input as unknown as Record<string, unknown>, a) === undefined) missing.push(`${n} ${f.key}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});
