// 表を何歳まで見るかの1つの欄（0070 の追記 2026-11-13）:
// - 前は「表を何歳まで見るか（若い方の年齢）」「表の最後の年」「ご本人が何歳になる年まで」「配偶者が何歳になる年まで」の4つの欄で同じ値（表の最後の年）を
//   入れていた。人と年齢で選ぶ1つの欄にした（ご本人が90〜105歳まで・配偶者が90〜105歳まで・年で決める…）
// - 既定（若い方が既定の年齢になる年）の選択肢に「（既定）」。生まれ年が同じなら「ご本人・配偶者が○歳まで」の1つにまとめる。単身はご本人だけ
// - 選んだ人と年齢は世帯に持ち（endYearChoice。形式 0.77）、その人の生年月を直しても同じ年齢のまま付いていく。年で決めた年は付いていかない
// - 前の版の世帯（決め方を持たない）は年から読む（既定・若い方の年齢・年で決める）
import { describe, expect, it } from "vitest";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { endYearRuleOf, followStandards, fromRequest, mutate, standardEndYear, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { endYearNotice } from "../src/workspace/input/stages/assumptions.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { bodyObject, EMPTY_CARRY, fromBody } from "../src/workspace/store/body.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { modelHousehold } from "./helpers.ts";

/** モデル世帯（表の最後の年は標準にそろえる） */
const open = (id: string): WorkingHousehold => mutate(fromRequest(modelHousehold(id)), (h, req) => void (req.input.endYear = standardEndYear(h, req.input.baseMonth)));
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(buildStage("assumptions", wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const endField = (wh: WorkingHousehold) => fieldOf(wh, "assume/endYear");
const labels = (wh: WorkingHousehold): string[] => {
  const f = endField(wh);
  return f.kind === "select" ? f.options.map((o) => o.label) : [];
};
const valueOf = (wh: WorkingHousehold, label: string): string => {
  const f = endField(wh);
  const o = f.kind === "select" ? f.options.find((x) => x.label === label) : undefined;
  if (o === undefined) throw new Error(`選択肢が無い: ${label}`);
  return o.value;
};
const choose = (wh: WorkingHousehold, label: string): WorkingHousehold => endField(wh).set(wh, valueOf(wh, label));
const adult = (wh: WorkingHousehold, kind: "self" | "spouse") => wh.request.input.household.members.find((m) => m.kind === kind)!;
const setBirth = (wh: WorkingHousehold, kind: "self" | "spouse", ym: string): WorkingHousehold =>
  followStandards(
    wh,
    mutate(wh, (h) => {
      const m = h.members.find((x) => x.kind === kind)!;
      m.birth = { ...m.birth, birthYearMonth: ym };
    }),
  );
const bodyState = (wh: WorkingHousehold) => ({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY });

describe("選択肢", () => {
  it("配偶者が若い夫婦: ご本人・配偶者の90〜105歳と「年で決める…」。既定は配偶者の100歳", () => {
    // ご本人 1981年7月・配偶者 1983年10月
    const wh = open("salariedCoupleTwoKids");
    expect(endField(wh).label).toBe("表を何歳まで見るか");
    expect(labels(wh)).toEqual(["ご本人が90歳まで", "ご本人が95歳まで", "ご本人が100歳まで", "ご本人が105歳まで", "配偶者が90歳まで", "配偶者が95歳まで", "配偶者が100歳まで（既定）", "配偶者が105歳まで", "年で決める…"]);
    expect(labels(wh).some((l) => l.includes("若い方"))).toBe(false);
    expect(endField(wh).get(wh).value).toBe("default");
    expect(endField(wh).get(wh).hint).toBe("2083年まで（ご本人 102歳・配偶者 100歳の年）");
    expect(fieldStatus(endField(wh), wh).status).toBe("estimated");
  });

  it("ご本人が若い夫婦: 既定はご本人の100歳", () => {
    // ご本人 1983年8月・配偶者 1981年4月
    const wh = open("advisoryFeeProposal");
    expect(labels(wh).filter((l) => l.includes("（既定）"))).toEqual(["ご本人が100歳まで（既定）"]);
    expect(endField(wh).get(wh).hint).toBe("2083年まで（ご本人 100歳・配偶者 102歳の年）");
  });

  it("単身: ご本人の選択肢だけ", () => {
    const wh = open("sampleSingle40s");
    expect(labels(wh)).toEqual(["ご本人が90歳まで", "ご本人が95歳まで", "ご本人が100歳まで（既定）", "ご本人が105歳まで", "年で決める…"]);
  });

  it("生まれ年が同じ夫婦: 「ご本人・配偶者が○歳まで」の1つにまとめる", () => {
    const wh = mutate(open("salariedCoupleTwoKids"), (h, req) => {
      h.members.find((m) => m.kind === "spouse")!.birth.birthYearMonth = "1981-02";
      req.input.endYear = standardEndYear(h, req.input.baseMonth);
    });
    expect(labels(wh)).toEqual(["ご本人・配偶者が90歳まで", "ご本人・配偶者が95歳まで", "ご本人・配偶者が100歳まで（既定）", "ご本人・配偶者が105歳まで", "年で決める…"]);
    const w95 = choose(wh, "ご本人・配偶者が95歳まで");
    expect(w95.request.input.endYear).toBe(2076);
    expect(endField(w95).get(w95).value).toBe(valueOf(wh, "ご本人・配偶者が95歳まで"));
  });

  it("ご本人の105歳と配偶者の100歳が同じ年でも、選んだ方を見せる（5歳違いの夫婦）", () => {
    // ご本人 1978年・配偶者 1983年: ご本人105歳＝配偶者100歳＝2083年
    const wh = mutate(open("salariedCoupleTwoKids"), (h, req) => {
      h.members.find((m) => m.kind === "self")!.birth.birthYearMonth = "1978-07";
      req.input.endYear = standardEndYear(h, req.input.baseMonth);
    });
    const w = choose(wh, "ご本人が105歳まで");
    expect(w.request.input.endYear).toBe(wh.request.input.endYear);
    expect(endField(w).get(w).value).toBe(valueOf(wh, "ご本人が105歳まで"));
    expect(fieldStatus(endField(w), w).status).toBe("confirmed");
    // （既定）を選ぶと既定に戻る（推定。決め方は持たない）
    const back = choose(w, "配偶者が100歳まで（既定）");
    expect(back.endYearChoice).toBeUndefined();
    expect(endField(back).get(back).value).toBe("default");
    expect(fieldStatus(endField(back), back).status).toBe("estimated");
  });

  it("「年で決める…」: すぐ下に年の欄。選択肢の外の年（ご本人102歳の年など）もこの形で見せる", () => {
    const wh = open("salariedCoupleTwoKids");
    expect(allFields(buildStage("assumptions", wh)).some((f) => f.key === "assume/endYear/year")).toBe(false);
    const byYear = choose(wh, "年で決める…");
    const keys = allFields(buildStage("assumptions", byYear)).map((f) => f.key);
    expect(keys.indexOf("assume/endYear/year")).toBe(keys.indexOf("assume/endYear") + 1);
    const year = fieldOf(byYear, "assume/endYear/year");
    expect(year.get(byYear).value).toBe(2083);
    const typed = year.set(byYear, 2090);
    expect(typed.request.input.endYear).toBe(2090);
    expect(endField(typed).get(typed).hint).toBe("2090年まで（ご本人 109歳・配偶者 107歳の年）");
    // 前の版の世帯で、選択肢の外の年（決め方を持たない）
    const old = mutate(wh, (_h, req) => void (req.input.endYear = 2083 - 1));
    expect(endField(old).get(old).value).toBe("year");
    expect(fieldOf(old, "assume/endYear/year").get(old).value).toBe(2082);
  });
});

describe("範囲の知らせ（若い方が85〜105歳の外）", () => {
  it("人と年齢の選択肢の年には出さない（年上の人の90歳で若い方が85歳に届かなくても）。「年で決める…」の年には外なら出す", () => {
    // ご本人 1960年・配偶者 1983年: ご本人の90歳の年（2050年）は配偶者67歳
    const wh = mutate(open("salariedCoupleTwoKids"), (h, req) => {
      h.members.find((m) => m.kind === "self")!.birth.birthYearMonth = "1960-07";
      req.input.endYear = standardEndYear(h, req.input.baseMonth);
    });
    const w90 = choose(wh, "ご本人が90歳まで");
    expect(w90.request.input.endYear).toBe(2050);
    expect(endYearNotice(w90)).toBeNull();
    const byYear = choose(wh, "年で決める…");
    const far = fieldOf(byYear, "assume/endYear/year").set(byYear, 2095);
    expect(endYearNotice(far)).toBe("表の最後の年が2095年（ご本人135歳・配偶者112歳）です。既定（2083年）にしますか");
    expect(endYearNotice(fieldOf(byYear, "assume/endYear/year").set(byYear, 2085))).toBeNull();
  });
});

describe("家族の生年月を直したとき", () => {
  it("既定のままなら、若い方の既定の年齢の年に付いていく（若い方が入れ替わっても）", () => {
    const wh = open("salariedCoupleTwoKids");
    const w = setBirth(wh, "self", "1990-01");
    expect(w.request.input.endYear).toBe(2090);
    expect(endField(w).get(w).value).toBe("default");
    expect(w.endYearChoice).toBeUndefined();
  });

  it("「ご本人が95歳まで」は、ご本人の生年月を直すとご本人の95歳の年。配偶者を直しても変わらない", () => {
    const wh = choose(open("salariedCoupleTwoKids"), "ご本人が95歳まで");
    expect(wh.request.input.endYear).toBe(2076);
    const self = adult(wh, "self");
    const w1 = setBirth(wh, "self", "1985-03");
    expect(w1.request.input.endYear).toBe(2080);
    expect(endField(w1).get(w1).value).toBe(`m:${self.id}:95`);
    // 配偶者がご本人より若くなっても、ご本人の95歳のまま
    const w2 = setBirth(w1, "spouse", "1995-03");
    expect(w2.request.input.endYear).toBe(2080);
    expect(endField(w2).get(w2).value).toBe(`m:${self.id}:95`);
  });

  it("「配偶者が105歳まで」は、配偶者の生年月に付いていく", () => {
    const wh = choose(open("salariedCoupleTwoKids"), "配偶者が105歳まで");
    const w = setBirth(wh, "spouse", "1980-05");
    expect(w.request.input.endYear).toBe(2085);
    expect(endYearRuleOf(w)).toEqual({ kind: "member", member: adult(wh, "spouse").id, age: 105 });
  });

  it("「年で決める…」の年は変わらない", () => {
    const wh0 = choose(open("salariedCoupleTwoKids"), "年で決める…");
    const wh = fieldOf(wh0, "assume/endYear/year").set(wh0, 2070);
    expect(setBirth(wh, "spouse", "1995-03").request.input.endYear).toBe(2070);
    expect(setBirth(wh, "self", "1995-03").request.input.endYear).toBe(2070);
  });
});

describe("前の版で保存した世帯", () => {
  const saved = (wh: WorkingHousehold) => fromBody(JSON.stringify({ ...bodyObject(bodyState(wh)), meta: { formatVersion: "0.76" } })).wh;

  it("決め方を持たない世帯は年から読む: 既定・若い方の年齢（前の選び方の「95歳まで」）・確定した年・選択肢の外の年", () => {
    const base = open("salariedCoupleTwoKids");
    const spouse = adult(base, "spouse");
    expect(endField(saved(base)).get(saved(base)).value).toBe("default");
    // 前の選び方の「95歳まで」（若い方＝配偶者の95歳の年。年だけを持っていた）
    const w95 = saved(mutate(base, (_h, req) => void (req.input.endYear = 1983 + 95)));
    expect(w95.endYearChoice).toBeUndefined();
    expect(endField(w95).get(w95).value).toBe(`m:${spouse.id}:95`);
    // 家族を直すと、その人とその年齢で付いていく。年から読んで同じ人と年齢になるあいだは、決め方を世帯に書き足さない
    const moved = setBirth(w95, "spouse", "1986-01");
    expect(moved.request.input.endYear).toBe(1986 + 95);
    expect(endYearRuleOf(moved)).toEqual({ kind: "member", member: spouse.id, age: 95 });
    expect(moved.endYearChoice).toBeUndefined();
    // ご本人が配偶者より若くなり、ご本人の90歳の年と同じ年になっても、配偶者の95歳のまま（このときは決め方を持つ）
    const swapped = setBirth(moved, "self", "1991-02");
    expect(swapped.request.input.endYear).toBe(1986 + 95);
    expect(endYearRuleOf(swapped)).toEqual({ kind: "member", member: spouse.id, age: 95 });
    expect(swapped.endYearChoice).toEqual({ by: "member", member: spouse.id, age: 95 });
    // 確定した年（前の版の「この値にする」）は年で決めた年
    const pinned = saved(
      mutate(base, (_h, req) => {
        (req.input as { valueStates?: Record<string, unknown> }).valueStates = { "plan.endYear": { state: "confirmed", origin: { kind: "manual" } } };
      }),
    );
    expect(endField(pinned).get(pinned).value).toBe("year");
    expect(endYearRuleOf(pinned)).toEqual({ kind: "year" });
    // 外れた年は年で決めた年で、範囲の知らせも今までどおり
    const off = saved(mutate(base, (_h, req) => void (req.input.endYear = 2125)));
    expect(endField(off).get(off).value).toBe("year");
    expect(endYearNotice(off)).toContain("既定（2083年）にしますか");
  });

  it("決め方を保存して読み戻す。形の合わない決め方・年の合わない決め方（ほかで年を変えた）は年から読む", () => {
    // ご本人 1978年・配偶者 1983年の「ご本人が105歳まで」（既定の配偶者の100歳と同じ年。年からは読めないので決め方を持つ）
    const five = mutate(open("salariedCoupleTwoKids"), (h, req) => {
      h.members.find((m) => m.kind === "self")!.birth.birthYearMonth = "1978-07";
      req.input.endYear = standardEndYear(h, req.input.baseMonth);
    });
    const wh = choose(five, "ご本人が105歳まで");
    expect(wh.endYearChoice).toEqual({ by: "member", member: adult(wh, "self").id, age: 105 });
    const body = bodyObject(bodyState(wh)) as unknown as { household: { endYearChoice?: unknown } };
    expect(body.household.endYearChoice).toEqual(wh.endYearChoice);
    expect(fromBody(JSON.stringify(body)).wh.endYearChoice).toEqual(wh.endYearChoice);
    const bad = fromBody(JSON.stringify({ ...body, household: { ...body.household, endYearChoice: { by: "member", member: "x", age: 97 } } })).wh;
    expect(bad.endYearChoice).toBeUndefined();
    // AI接続口などで年だけを変えた世帯: 決め方の年と合わないので年から読む（計算は表の最後の年だけを使う）
    const changed = mutate(wh, (_h, req) => void (req.input.endYear = 2080));
    expect(endField(changed).get(changed).value).toBe("year");
  });
});
