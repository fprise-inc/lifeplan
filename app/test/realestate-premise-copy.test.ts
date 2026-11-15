// 不動産の評価の土地の割合・建物の残りの価値の下限・売却の費用を、ほかの前提条件と同じ決まりにそろえる（0218）:
// 新しい世帯に写す・値の無い世帯は開いたときに今の事務所の値を写す（計算の結果は変わらない）・後で事務所の値を変えても写した世帯は変わらず、
// 確かめの一覧に「事務所の既定値が変わりました」と出て1押しで当てられる・物件ごとの値が先に効く順は変えない
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { fillLivePremises, PREMISE_DEFS, premiseState } from "../src/workspace/input/premiseDefaults.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { setOfficeNow, STANDARD_OFFICE_NOW } from "../src/workspace/office/current.ts";
import { EMPTY_ESTIMATES, withOfficeValue, type OfficeEstimates } from "../src/workspace/office/estimates.ts";
import { applyOfficeDefaults, DEFAULT_OFFICE_SETTINGS, publishOfficeSettings, type OfficeSettings } from "../src/workspace/office/settings.ts";
import { bodyOf, fromBody } from "../src/workspace/store/body.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const LAND = "preset.realEstate.landShare";
const FLOOR = "preset.realEstate.residualFloor";
const SALE = "preset.realEstate.saleCostRate";
const LIVE = PREMISE_DEFS.filter((d) => d.live !== undefined);
const KEYS = { landShare: "assume/realEstate/landShare", floor: "assume/realEstate/floor", saleCost: "assume/realEstate/saleCost" };

const estimates = (land: string, floor: string, sale: string): OfficeEstimates => {
  let e = EMPTY_ESTIMATES;
  e = withOfficeValue(e, LAND, land, null, "2026-11-15");
  e = withOfficeValue(e, FLOOR, floor, null, "2026-11-15");
  e = withOfficeValue(e, SALE, sale, null, "2026-11-15");
  return e;
};
/** 事務所の値を変えた事務所（3つとも提供元の既定の値と違う） */
const CHANGED: OfficeSettings = { ...DEFAULT_OFFICE_SETTINGS, estimates: estimates("0.45", "0.1", "0.06"), changedOn: "2026-11-15" };
/** その後にもう一度変えた事務所 */
const CHANGED_AGAIN: OfficeSettings = { ...DEFAULT_OFFICE_SETTINGS, estimates: estimates("0.5", "0.25", "0.05"), changedOn: "2026-12-01" };

afterEach(() => {
  publishOfficeSettings(DEFAULT_OFFICE_SETTINGS);
  setOfficeNow(STANDARD_OFFICE_NOW);
});

let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(buildStage("assumptions", wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const valuation = (wh: WorkingHousehold) => wh.request.input.assumptions?.realEstateValuation;
/** 計算の結果（表・要約・相続税の目安・計算のお知らせ） */
const result = (r: PreviewResult) => JSON.stringify([r.table, r.summary, r.inheritanceTax ?? null, r.header.notices ?? []]);
/** お金の結果だけ（表・要約） */
const money = (r: PreviewResult) => JSON.stringify([r.table, r.summary]);
const calc = (req: EngineRequest) => preview(forEngine(req));
/** 計算の結果の文字（計算できない前の形式の見本は、そのエラー。写した後も同じエラーになること） */
const run = (req: EngineRequest, of: (r: PreviewResult) => string): string => {
  try {
    return of(calc(req));
  } catch (e) {
    return `error: ${String(e)}`;
  }
};

/** 見本の世帯（data/modelHouseholds）と、前の形式の見本（crates/household-store/tests/fixtures/household-format。同じ世帯は1つに） */
const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();
const FORMAT_DIR = join(REPO_DIR, "crates", "household-store", "tests", "fixtures", "household-format");
const FORMATS = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of readdirSync(FORMAT_DIR).filter((x) => /^\d+\.\d+$/.test(x))) {
    const req = JSON.stringify(fromBody(readFileSync(join(FORMAT_DIR, v, "body.json"), "utf8")).wh.request);
    if (seen.has(req)) continue;
    seen.add(req);
    out.push(v);
  }
  return out;
})();
const formatHousehold = (v: string) => fromBody(readFileSync(join(FORMAT_DIR, v, "body.json"), "utf8")).wh;

describe("新しい世帯に写す（0218）", () => {
  it("事務所で決めていなければ提供元の既定の値を、ほかの前提条件と同じ「事務所の既定値（年月）」の印で写す", () => {
    const wh = applyOfficeDefaults(blankHousehold("2026-11", ids()), DEFAULT_OFFICE_SETTINGS);
    expect(valuation(wh)).toEqual({ landShare: "0.3", residualFloor: "0.2", saleCostRate: "0.04" });
    for (const d of LIVE) expect(wh.assumed[d.key], d.key).toBe("事務所の既定値（設定）");
  });

  it("事務所の値を写し、欄は「事務所の既定値」（事務所で決めた値）", () => {
    publishOfficeSettings(CHANGED);
    const wh = applyOfficeDefaults(withHome(blankHousehold("2026-11", ids())), CHANGED);
    expect(valuation(wh)).toEqual({ landShare: "0.45", residualFloor: "0.1", saleCostRate: "0.06" });
    for (const key of Object.values(KEYS)) {
      expect(wh.assumed[key], key).toBe("事務所の既定値（2026-11）");
      expect(fieldStatus(fieldOf(wh, key), wh).premise, key).toMatchObject({ state: "office", decided: true });
    }
  });

  it("後で事務所の値を変えても世帯は変わらず、確かめの一覧に「事務所の既定値が変わりました」。1押しで当てる", () => {
    publishOfficeSettings(CHANGED);
    // 持ち家と収益不動産のある世帯を、事務所の値を変えた後に作った形（写した値と印）
    const wh = fillLivePremises(fromRequest(modelHousehold("sampleSeniorRental"), {}));
    expect(valuation(wh)).toEqual({ landShare: "0.45", residualFloor: "0.1", saleCostRate: "0.06" });
    const before = JSON.stringify(wh.request);
    const table = money(calc(wh.request));
    publishOfficeSettings(CHANGED_AGAIN);
    expect(JSON.stringify(wh.request)).toBe(before);
    expect(money(calc(wh.request))).toBe(table);
    const notices = checkList(wh).filter((r) => r.kind === "notice" && Object.values(KEYS).includes(r.fieldKey ?? ""));
    expect(Object.fromEntries(notices.map((r) => [r.fieldKey, r.detail]))).toEqual({
      [KEYS.landShare]: "事務所の既定値が変わりました（45%→50%）。この世帯は前の値で計算しています",
      [KEYS.floor]: "事務所の既定値が変わりました（10%→25%）。この世帯は前の値で計算しています",
      [KEYS.saleCost]: "事務所の既定値が変わりました（6%→5%）。この世帯は前の値で計算しています",
    });
    let next = wh;
    for (const r of notices) next = r.actions.find((a) => a.key === "office")!.run(next);
    expect(valuation(next)).toEqual({ landShare: "0.5", residualFloor: "0.25", saleCostRate: "0.05" });
    for (const key of Object.values(KEYS)) {
      expect(next.assumed[key], key).toBe("事務所の既定値（2026-12）");
      expect(fieldStatus(fieldOf(next, key), next).premise?.state, key).toBe("office");
    }
    expect(checkList(next).some((r) => r.kind === "notice" && Object.values(KEYS).includes(r.fieldKey ?? ""))).toBe(false);
  });

  it("この世帯だけの値は知らせない。空欄にすると事務所の今の値を書く（値を外さない）", () => {
    publishOfficeSettings(CHANGED);
    let wh = applyOfficeDefaults(withHome(blankHousehold("2026-11", ids())), CHANGED);
    wh = fieldOf(wh, KEYS.floor).set(wh, "0.15");
    expect(wh.assumed[KEYS.floor]).toBeUndefined();
    publishOfficeSettings(CHANGED_AGAIN);
    expect(fieldStatus(fieldOf(wh, KEYS.floor), wh).premise?.state).toBe("household");
    expect(checkList(wh).some((r) => r.kind === "notice" && r.fieldKey === KEYS.floor)).toBe(false);
    wh = fieldOf(wh, KEYS.floor).set(wh, null);
    expect(valuation(wh)?.residualFloor).toBe("0.25");
    expect(fieldStatus(fieldOf(wh, KEYS.floor), wh).premise?.state).toBe("office");
  });
});

/** 見本の持ち家（不動産の評価の区画を出す） */
function withHome(wh: WorkingHousehold): WorkingHousehold {
  const home = structuredClone(modelHousehold("salariedCoupleTwoKids").input.household.residences![0]!);
  return mutate(wh, (hh) => {
    (hh.residences ??= []).push({ ...home, from: { at: "2016-04" }, ownership: [{ member: hh.members[0]!.id, share: "1" }] } as never);
  });
}

describe("値の無い世帯は開いたときに今の事務所の値を写す。計算の結果は変わらない（0218）", () => {
  const check = (wh: WorkingHousehold, office: OfficeSettings) => {
    publishOfficeSettings(office);
    const before = run(wh.request, result);
    const filled = fillLivePremises(wh);
    // 写すのは3つの欄と印だけ。ほかの所は変えない
    expect(filled).not.toBe(wh);
    expect(fillLivePremises(filled)).toBe(filled);
    for (const d of LIVE) {
      expect(filled.assumed[d.key], d.key).toMatch(/^事務所の既定値/);
      expect(premiseState(d, filled)?.state, d.key).toBe("office");
    }
    const strip = (w: WorkingHousehold) => {
      const r = structuredClone(w.request);
      const rv = r.input.assumptions?.realEstateValuation;
      if (rv !== undefined) for (const k of ["landShare", "residualFloor", "saleCostRate"] as const) delete rv[k];
      if (rv !== undefined && Object.keys(rv).length === 0) delete r.input.assumptions!.realEstateValuation;
      return JSON.stringify(r);
    };
    expect(strip(filled)).toBe(strip(wh));
    // 計算の結果（表・要約・相続税の目安・計算のお知らせ）が写す前と同じ
    expect(run(filled.request, result)).toBe(before);
    return { filled, after: run(filled.request, money) };
  };

  it.each(MODELS)("見本の世帯 %s（事務所の値が既定のまま・変えた後）。写した後に事務所の値を変えても、お金の結果は変わらない", (id) => {
    const wh = fromRequest(modelHousehold(id), {});
    check(wh, DEFAULT_OFFICE_SETTINGS);
    const { filled, after } = check(wh, CHANGED);
    publishOfficeSettings(CHANGED_AGAIN);
    expect(run(filled.request, money)).toBe(after);
  });

  it.each(FORMATS)("前の形式の見本 %s（事務所の値を変えた後）。写した後に事務所の値を変えても、お金の結果は変わらない", (v) => {
    const { filled, after } = check(formatHousehold(v), CHANGED);
    publishOfficeSettings(CHANGED_AGAIN);
    expect(run(filled.request, money)).toBe(after);
  });

  it("写した値と印は世帯ファイルに書いて読み戻せる（形式の版は変えない）", () => {
    publishOfficeSettings(CHANGED);
    const v = FORMATS.at(-1)!;
    const st = fromBody(readFileSync(join(FORMAT_DIR, v, "body.json"), "utf8"));
    const filled = fillLivePremises(st.wh);
    const again = fromBody(bodyOf({ ...st, wh: filled })).wh;
    expect(valuation(again)).toMatchObject({ landShare: "0.45", residualFloor: "0.1", saleCostRate: "0.06" });
    for (const d of LIVE) expect(again.assumed[d.key], d.key).toBe("事務所の既定値（2026-11）");
  });
});

describe("境目: 古い建物の残りの価値の下限・売却する年・物件ごとの値（0218）", () => {
  /** 写す前は事務所の値を変えると結果が変わり、写した後は変わらない */
  const fixedAfterFill = (req: EngineRequest) => {
    publishOfficeSettings(CHANGED);
    const wh = fromRequest(req, {});
    const filled = fillLivePremises(wh);
    const was = money(calc(filled.request));
    expect(money(calc(wh.request))).toBe(was);
    publishOfficeSettings(CHANGED_AGAIN);
    // 写していない世帯は事務所の値でその場で変わる（直した前の動き）、写した世帯は変わらない
    expect(money(calc(wh.request))).not.toBe(was);
    expect(money(calc(filled.request))).toBe(was);
    return filled;
  };

  it("1995年の木造の持ち家（建物の残りの価値の下限が効く）", () => {
    const req = structuredClone(modelHousehold("sampleSeniorCouple"));
    const r = req.input.household.residences!.find((x) => x.kind === "own")!;
    expect(r.valuation?.builtYear).toBe(1995);
    // 土地の割合を物件に入れて、下限だけが効く形にする
    r.valuation = { ...r.valuation!, landShare: "0.4" };
    const filled = fixedAfterFill(req);
    // 下限の値は結果に効く（世帯の前提条件の値を変えると変わる）
    const other = fieldOf(filled, KEYS.floor).set(filled, "0.05");
    expect(money(calc(other.request))).not.toBe(money(calc(filled.request)));
  });

  it("売却する年がある持ち家と収益不動産（売却の費用が効く）", () => {
    const req = structuredClone(modelHousehold("rentalSample"));
    const h = req.input.household;
    const own = h.residences!.find((x) => x.kind === "own")!;
    own.to = { at: "2040-03" };
    own.sale = {};
    own.valuation = { ...own.valuation!, landShare: "0.4" };
    for (const a of h.accounts!.filter((x) => x.kind === "realEstate")) {
      a.property!.sale = { at: { at: "2036-03" } } as NonNullable<NonNullable<typeof a.property>["sale"]>;
      a.property!.landShare = "0.4";
    }
    const filled = fixedAfterFill(req);
    const other = fieldOf(filled, KEYS.saleCost).set(filled, "0.1");
    expect(money(calc(other.request))).not.toBe(money(calc(filled.request)));
  });

  it("物件ごとに入れた値が先に効く（物件の値 → 世帯の前提条件の値の順）。持ち家と収益不動産", () => {
    publishOfficeSettings(CHANGED);
    const req = structuredClone(modelHousehold("rentalSample"));
    const h = req.input.household;
    const own = h.residences!.find((x) => x.kind === "own")!;
    own.valuation = { ...own.valuation!, landShare: "0.4" };
    for (const a of h.accounts!.filter((x) => x.kind === "realEstate")) a.property!.landShare = "0.35";
    const filled = fillLivePremises(fromRequest(req, {}));
    // どの物件にも土地の割合があれば、世帯の前提条件の土地の割合を変えても結果は同じ
    const other = fieldOf(filled, KEYS.landShare).set(filled, "0.6");
    expect(money(calc(other.request))).toBe(money(calc(filled.request)));
    // 物件の値を1つ外すと、その物件は世帯の前提条件の値を使う
    const without = mutate(filled, (hh) => void delete hh.accounts!.find((x) => x.kind === "realEstate" && x.property?.acquisition?.parts === undefined)!.property!.landShare);
    const without2 = fieldOf(without, KEYS.landShare).set(without, "0.6");
    expect(money(calc(without2.request))).not.toBe(money(calc(without.request)));
  });

  it("物件の土地の割合が無いときの計算のお知らせは、写した後も出る（事務所の既定値の割合と同じ値のとき）", () => {
    publishOfficeSettings(CHANGED);
    const wh = fromRequest(modelHousehold("sampleSeniorRental"), {});
    const has = (r: PreviewResult) => (r.header.notices ?? []).some((x) => x.code === "N_DEFAULT_USED" && x.ids.includes("account.property.landShare"));
    expect(has(calc(wh.request))).toBe(true);
    const filled = fillLivePremises(wh);
    expect(valuation(filled)?.landShare).toBe("0.45");
    expect(has(calc(filled.request))).toBe(true);
    // この世帯だけの値にしたときは、前と同じく出さない（世帯で決めた割合）
    const own = fieldOf(filled, KEYS.landShare).set(filled, "0.35");
    expect(has(calc(own.request))).toBe(false);
  });
});
