// 入力の画面: 世帯データ → 入力の表示 → 世帯データ の往復（モデル世帯すべて）と、入力 → 世帯データの変換
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { addMonths, readLevers } from "../src/workspace/levers.ts";
import { allFields, type FieldDef, type Val } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage, buildStages, STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { addMember, removeMember } from "../src/workspace/input/stages/family.ts";
import { formatYen, fromPeriod, parseYearMonth, parseYen, pctFromRate, rateFromPct, sameRate, shiftDecimal, toPeriod, wareki } from "../src/workspace/input/units.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { modelHousehold, preview } from "./helpers.ts";

const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

function open(id: string): WorkingHousehold {
  const demo = demoHousehold(id);
  const req = modelHousehold(id);
  const self = req.input.household.members.find((m) => m.kind === "self")!;
  return fromRequest(req, demo?.reemployment !== undefined ? { postRetirement: { [self.id]: { ...demo.reemployment, type: demo.reemployment.type as "contract" } } } : {});
}

/** 欄の値を少しずらす（往復のテスト用）。ずらせない欄は undefined */
function perturb(f: FieldDef, v: Val, wh: WorkingHousehold): Val | undefined {
  switch (f.kind) {
    case "yen":
      return v === null ? 120000 : (v as number) + 12000;
    case "int": {
      const max = f.max ?? 1_000_000;
      const min = f.min ?? 0;
      if (v === null) return Math.min(max, Math.max(min, 1));
      return (v as number) + 1 <= max ? (v as number) + 1 : (v as number) - 1 >= min ? (v as number) - 1 : undefined;
    }
    case "pct":
    case "decimal":
      return v === null ? "0.012" : shiftDecimal((Number(v) + (f.kind === "pct" ? 0.001 : 1)).toFixed(10), 0);
    case "ym":
      return v === null ? addMonths(wh.request.input.baseMonth, 12) : addMonths(String(v), 1);
    case "bool":
      return v !== true;
    case "text":
      return `${v ?? ""}x`;
    case "select": {
      const o = f.options.find((x) => x.value !== v && x.value !== "");
      return o?.value;
    }
  }
}

const roundTripable = (f: FieldDef, s: ReturnType<FieldDef["get"]>) => !(s.value === null && f.blankIsEstimate === true) && f.readOnly === undefined && f.structural !== true && f.sideEffects === undefined && s.derived == null && s.implicit !== true && s.estimated == null && s.assumed == null;

describe("単位と書式", () => {
  it("万円・円の書き方と読み方は往復で1円もずれない", () => {
    for (const v of [0, 1, 9999, 10000, 123456, 4200000, 32000000, 1234567890]) {
      expect(parseYen(formatYen(v, "man"), "man")).toBe(v);
      expect(parseYen(formatYen(v, "yen"), "yen")).toBe(v);
    }
    expect(formatYen(4200000, "man")).toBe("420");
    expect(formatYen(123456, "man")).toBe("12.3456");
    expect(formatYen(32000000, "man")).toBe("3,200");
    expect(parseYen("１２．５万円", "man")).toBe(125000);
    expect(parseYen("1,234", "yen")).toBe(1234);
    expect(parseYen("abc", "man")).toBeNull();
  });
  it("月額と年額", () => {
    expect(toPeriod(25000, "monthly", "annual")).toBe(300000);
    expect(fromPeriod(300000, "monthly", "annual")).toBe(25000);
    expect(toPeriod(1000000, "annual", "monthly")).toBeNull();
    expect(toPeriod(1200000, "annual", "monthly")).toBe(100000);
  });
  it("率は10進の文字列のまま百分率にする", () => {
    expect(pctFromRate("0.0065")).toBe("0.65");
    expect(pctFromRate("0.01")).toBe("1");
    expect(pctFromRate("1")).toBe("100");
    expect(rateFromPct("0.65")).toBe("0.0065");
    expect(rateFromPct("１．５%")).toBe("0.015");
    expect(sameRate("0.010", "0.01")).toBe(true);
    expect(rateFromPct(pctFromRate("0.0123456"))).toBe("0.0123456");
  });
  it("年月と和暦", () => {
    expect(parseYearMonth("2041/6")).toBe("2041-06");
    expect(parseYearMonth("2041年6月")).toBe("2041-06");
    expect(parseYearMonth("2041-13")).toBeNull();
    expect(wareki("1981-07")).toBe("昭和56年7月");
    expect(wareki("2019-05")).toBe("令和元年5月");
  });
});

describe("モデル世帯の往復（世帯データ → 入力の表示 → 世帯データ）", () => {
  it.each(MODELS)("%s", (id) => {
    const wh = open(id);
    const before = JSON.stringify(wh.request);
    let fields = 0;
    let moved = 0;
    for (const stage of buildStages(wh)) {
      for (const f of allFields(stage)) {
        fields++;
        const s = f.get(wh);
        // 同じ値を入れ直しても世帯は変わらない
        expect(JSON.stringify(f.set(wh, s.value)), f.key).toBe(JSON.stringify(wh));
        // 表示の書式の往復
        if (f.kind === "yen" && typeof s.value === "number") {
          expect(parseYen(formatYen(s.value, "man"), "man")).toBe(s.value);
          expect(parseYen(formatYen(s.value, "yen"), "yen")).toBe(s.value);
        }
        if (f.kind === "pct" && typeof s.value === "string") expect(sameRate(rateFromPct(pctFromRate(s.value)), s.value), f.key).toBe(true);
        if (f.kind === "ym" && typeof s.value === "string") expect(parseYearMonth(s.value)).toBe(s.value);
        // 値を変えて戻すと、元の世帯データに戻る（入力 → 世帯データ → 入力）
        if (!roundTripable(f, s)) continue;
        const v2 = perturb(f, s.value, wh);
        if (v2 === undefined) continue;
        const w1 = f.set(wh, v2);
        const got = f.get(w1).value;
        if (f.kind === "pct" || f.kind === "decimal") expect(sameRate(got as string, v2 as string), f.key).toBe(true);
        else expect(got, f.key).toBe(v2);
        expect(JSON.stringify(w1), f.key).not.toBe(JSON.stringify(wh));
        const w2 = f.set(w1, s.value);
        expect(w2, f.key).toEqual(wh);
        moved++;
      }
    }
    expect(JSON.stringify(wh.request)).toBe(before);
    expect(fields).toBeGreaterThan(5);
    expect(moved).toBeGreaterThan(3);
  });
});

describe("入力 → 世帯データ（計算できる形のまま）", () => {
  it.each(MODELS)("%s: 欄をまとめて変えても計算できる", (id) => {
    let wh = open(id);
    for (const stage of buildStages(wh)) {
      for (const f of allFields(stage)) {
        if (f.kind === "ym" || f.kind === "select" || f.kind === "bool" || f.kind === "text") continue;
        const s = f.get(wh);
        if (!roundTripable(f, s) || s.value === null) continue;
        const v2 = perturb(f, s.value, wh);
        if (v2 !== undefined) wh = f.set(wh, v2);
      }
    }
    expect(() => preview(wh.request)).not.toThrow();
  });
});

describe("段階の操作（足す・外す・選ぶ）", () => {
  it("空の世帯から入れ始められる（本人だけ・推定の生活費・仮の生年月）", () => {
    const wh = blankHousehold("2026-10", (() => {
      let n = 0;
      return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    })());
    expect(wh.request.input.household.members).toHaveLength(1);
    const family = buildStage("family", wh);
    const birth = allFields(family).find((f) => f.key.endsWith("/birth"))!;
    expect(birth.get(wh).assumed).toBeTruthy();
    // 生年月を入れ直すと「仮」の印が消える
    const w1 = birth.set(wh, "1985-06");
    expect(birth.get(w1).assumed).toBeNull();
    expect(w1.request.input.household.members[0]!.birth.birthYearMonth).toBe("1985-06");
    // 基本生活費は統計の目安（推定）から始まる。家族を足すと目安も入れ直す
    const lv = allFields(buildStage("living", w1)).find((f) => f.key.endsWith("/monthly"))!;
    expect(lv.get(w1).estimated).toContain("家計調査");
    expect(lv.get(w1).value).toBe(140000);
    const w2 = withRefreshedEstimates(addMember(w1, "spouse"));
    expect(lv.get(w2).value).toBe(250000);
    // 消すと「目安で入れる」が出る
    const w2b = buildStage("living", w2).sections[0]!.groups[0]!;
    expect(w2b.fields.length).toBeGreaterThan(0);
    // 働き方を入れる → 年収は推定
    const start = buildStage("work", w2).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
    const w3 = start.run(w2);
    const annual = allFields(buildStage("work", w3)).find((f) => f.key.endsWith("/annual"))!;
    expect(annual.get(w3).estimated).toContain("賃金構造基本統計調査");
    // 推定の欄を空にしたまま計算できる。値を入れると確定になる
    expect(() => preview(w3.request)).not.toThrow();
    const w4 = annual.set(w3, 5000000);
    expect(annual.get(w4)).toMatchObject({ value: 5000000, estimated: null });
    // 空にすると推定に戻る
    expect(annual.get(annual.set(w4, null)).estimated).toContain("賃金構造基本統計調査");
    expect(() => preview(w4.request)).not.toThrow();
  });

  it("すべての段階の「足す」操作の後も計算できる（空の世帯・モデル世帯）", () => {
    for (const start of [blankHousehold("2026-10"), open("salariedCoupleTwoKids"), open("housingGiftFromParents")]) {
      let wh = addMember(addMember(start, "spouse"), "child");
      for (const { id } of STAGE_ORDER) {
        for (const section of buildStage(id, wh).sections) {
          for (const a of [...section.actions, ...section.groups.flatMap((g) => g.actions)]) {
            if (a.danger === true) continue;
            wh = a.run(wh);
          }
        }
      }
      expect(() => preview(wh.request)).not.toThrow();
    }
  });

  it("構造の選択（働き方の種類・年金の入れ方・住まい・口座の種類）を変えても計算できる", () => {
    const wh = open("salariedCoupleTwoKids");
    for (const { id } of STAGE_ORDER) {
      for (const f of allFields(buildStage(id, wh))) {
        if (f.kind !== "select" || f.structural !== true) continue;
        for (const o of f.options) {
          const w = f.set(wh, o.value);
          try {
            preview(w.request);
          } catch (e) {
            // 既知の制限: 国民健康保険の所得割の基礎控除の制度データが2025年度からなので、
            // 2024年度以前に国保の月がある世帯（過去から自営業の期間など）は計算エンジンが値なしで止まる（PR に書いた残り）
            expect(String(e), `${f.key}=${o.value}`).toContain("socialInsurance.nationalHealth.incomeDeduction");
          }
        }
      }
    }
  });

  it("家族を外すと、その人を指す物もいっしょに外れる", () => {
    const wh = open("salariedCoupleTwoKids");
    const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const w = removeMember(wh, spouse.id);
    const text = JSON.stringify(w.request);
    expect(text).not.toContain(spouse.id);
    expect(() => preview(w.request)).not.toThrow();
  });

  it("定年後の予定: 再雇用の条件は世帯の側に持ち、働く最後の年齢を延ばすと再雇用の期間を足す", () => {
    const wh = open("salariedCoupleTwoKids");
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const work = allFields(buildStage("work", wh));
    const retire = work.find((f) => f.key === `work/${self.id}/retireAge`)!;
    const salary = work.find((f) => f.key === `work/${self.id}/postSalary`)!;
    expect(retire.get(wh).value).toBe(60);
    expect(salary.get(wh).value).toBe(4200000);
    const w1 = salary.set(wh, 3600000);
    const w2 = retire.set(w1, 65);
    expect(readLevers(w2.request, self.id).retireAge).toBe(65);
    const re = w2.request.input.household.employmentPeriods!.filter((e) => e.member === self.id).at(-1)!;
    expect(re.type).toBe("contract");
    expect(re.salary?.annual.value).toBe(3600000);
    // 定年後の年収を変えると、すでにある再雇用の期間の年収も変わる
    const w3 = salary.set(w2, 3000000);
    expect(w3.request.input.household.employmentPeriods!.filter((e) => e.member === self.id).at(-1)!.salary?.annual.value).toBe(3000000);
  });

  it("贈与する人を家族の段階で登録し、住宅資金の援助で選べる", () => {
    let wh = open("housingPurchase");
    const fam = buildStage("family", wh);
    wh = fam.sections[1]!.actions[0]!.run(wh);
    const donor = wh.request.input.household.donors![0]!;
    const housing = buildStage("housing", wh);
    const addGift = housing.sections[0]!.groups.flatMap((g) => g.actions).find((a) => a.key.endsWith("/addGiftAction"));
    expect(addGift).toBeDefined();
    wh = addGift!.run(wh);
    const gifts = wh.request.input.household.residences!.flatMap((r) => r.purchase?.gifts ?? []);
    expect(gifts.some((g) => g.donor === donor.id)).toBe(true);
    expect(() => preview(wh.request)).not.toThrow();
  });
});

describe("入力の段階", () => {
  it("10段階が決まった順番で並ぶ", () => {
    expect(buildStages(open("salariedCoupleTwoKids")).map((s) => s.label)).toEqual(["家族", "働き方と収入", "年金", "基本生活費", "子ども・教育", "住まい・ローン", "保険", "貯蓄・運用", "ライフイベント", "前提条件"]);
  });
  it("簡易の欄がどの段階にもある（子のいない世帯の教育を除く）", () => {
    const wh = open("salariedCoupleTwoKids");
    for (const s of buildStages(wh)) expect(allFields(s).filter((f) => f.level === "simple").length + s.sections.flatMap((x) => x.actions).length, s.id).toBeGreaterThan(0);
  });
  it("欄の入力項目ID は登録簿にあるもの", async () => {
    const { readFileSync } = await import("node:fs");
    const ids = new Set([...readFileSync(join(REPO_DIR, "registry", "items.yaml"), "utf8").matchAll(/- id: (\S+)/g)].map((m) => m[1]));
    for (const id of MODELS) for (const s of buildStages(open(id))) for (const f of allFields(s)) if (f.item !== null) expect(ids.has(f.item), `${f.key} ${f.item}`).toBe(true);
  });
  it("氏名の欄は無い", () => {
    for (const s of buildStages(open("salariedCoupleTwoKids"))) for (const f of allFields(s)) expect(f.label).not.toMatch(/氏名|お名前|名前（/);
  });
});

void ({} as EngineRequest);
