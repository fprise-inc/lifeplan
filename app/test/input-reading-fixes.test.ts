// 入力の欄の読み取りの直し（0162）: 時点の欄は「誰の年齢で」に選んでいる人の年齢で読む・終わりが始まりより前を止める・生年月は今月まで
// （120歳まで）・生年月日を日つきで打っても年月で入れる・収益不動産の割合の欄は 0〜100%・率の欄はどこも全角の数字と「％」を読む
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Timepoint } from "../src/engine/types.ts";
import { readField, rejectReason } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef, type StageId } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage, buildStages } from "../src/workspace/input/stages/index.ts";
import { parseDatedYearMonth, rateFromPct } from "../src/workspace/input/units.ts";
import { endBeforeStart, modeOf, parseWhen, typingCtx, withPerson } from "../src/workspace/input/when.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { parseNumber } from "../src/workspace/office/estimateCatalog.ts";
import { pctToRate } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { resolveTimepoint } from "../src/workspace/timepoint.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));
const open = (id: string) => fromRequest(modelHousehold(id));
const fieldOf = (wh: WorkingHousehold, card: StageId, test: (f: FieldDef) => boolean): FieldDef => allFields(buildStage(card, wh)).find(test)!;
const O = { unit: "man" as const, period: "monthly" as const, baseMonth: "2026-11" };

/** 欄に文字を打って離れたときと同じ道で書く（FieldViews.tsx の WhenField: 打った文字は typingCtx で読む） */
function typeWhen(f: FieldDef, wh: WorkingHousehold, text: string): WorkingHousehold | string {
  const st = f.time!.state(wh);
  const shown = st.linked?.at ?? st.raw;
  const r = parseWhen(text, typingCtx(st.ctx, shown, modeOf(shown, st.ctx)));
  if (!r.ok) return r.reason;
  return endBeforeStart(st.ctx, r.tp) ?? f.time!.setWhen(wh, r.tp, "auto");
}

describe("時点の欄: 「誰の年齢で」で選んだ人の年齢として、打った数字を読む", () => {
  it("手当・給付金の終わりで第1子を選んでから「20」と打つと、第1子の20歳（ご本人の20歳にならない）", () => {
    let wh = open("salariedCoupleTwoKids");
    const add = buildStage("family", wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((a) => a.label === "＋ 手当・給付金")!;
    wh = add.run(wh);
    const flow = (wh.request.input.household.incomeFlows ?? []).at(-1)!;
    const to = fieldOf(wh, "family", (f) => f.key.endsWith(`${flow.id}/to`));
    const st = to.time!.state(wh);
    const children = wh.request.input.household.members.filter((m) => m.kind === "child");
    const first = children[0]!.id;
    expect(st.ctx.person).not.toBe(first);
    // 横の「誰の年齢で」で第1子を選ぶ（FieldViews.tsx の when-who と同じ書き方）
    const picked = to.time!.setWhen(wh, withPerson(st.raw ?? { memberAge: { member: st.ctx.person!, years: 18 } }, first, st.ctx), "this");
    expect(to.time!.state(picked).raw?.memberAge?.member).toBe(first);
    const typed = typeWhen(to, picked, "20");
    expect(typeof typed).not.toBe("string");
    const tp = to.time!.state(typed as WorkingHousehold).raw as Timepoint;
    expect(tp.memberAge).toMatchObject({ member: first, years: 20 });
    expect(resolveTimepoint(wh.request.input.household, tp)! > wh.request.input.baseMonth).toBe(true);
  });

  it("人を選べる時点の欄の全部（見本の棚の全部の世帯）: 年齢の形で人を選んでいる欄に数字だけ打つと、その人の年齢になる", () => {
    let checked = 0;
    const keys = new Set<string>();
    for (const id of MODELS) {
      const wh = open(id);
      for (const f of buildStages(wh).flatMap((s) => allFields(s))) {
        if (f.time === undefined || f.readOnly !== undefined) continue;
        const st = f.time.state(wh);
        const ctx = st.ctx;
        if (!ctx.modes.includes("age") || ctx.people.length < 2 || ctx.personFixed === true) continue;
        const other = ctx.people.find((p) => p.id !== ctx.person)!;
        const shown: Timepoint = { memberAge: { member: other.id, years: 50 } };
        const r = parseWhen("60", typingCtx(ctx, shown, "age"));
        expect(r.ok, `${id} ${f.key}`).toBe(true);
        if (r.ok) expect(r.tp?.memberAge?.member, `${id} ${f.key}`).toBe(other.id);
        // 人の名前を書いたときは、書いた人のまま
        const named = ctx.people.find((p) => p.id !== other.id && p.names.length > 0);
        if (named !== undefined) {
          const n = parseWhen(`${named.names[0]}60歳`, typingCtx(ctx, shown, "age"));
          if (n.ok) expect(n.tp?.memberAge?.member, `${id} ${f.key}`).toBe(named.id);
        }
        keys.add(f.key.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "*"));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(keys.size).toBeGreaterThan(10);
  });

  it("今の時点が年月の形なら、欄の既定の人の年齢で読む（前と同じ）", () => {
    const wh = open("salariedCoupleTwoKids");
    const f = buildStages(wh).flatMap((s) => allFields(s)).find((x) => x.time !== undefined && x.time.state(wh).ctx.people.length > 1 && x.time.state(wh).ctx.person !== null && x.time.state(wh).ctx.modes.includes("age"))!;
    const ctx = f.time!.state(wh).ctx;
    const r = parseWhen("60", typingCtx(ctx, { at: "2040-04" }, "age"));
    expect(r.ok && r.tp?.memberAge?.member).toBe(ctx.person);
  });
});

describe("時点の欄: 終わりが始まりより前を止める", () => {
  const setup = () => {
    let wh = open("salariedCoupleTwoKids");
    const add = buildStage("family", wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((a) => a.label === "＋ 手当・給付金")!;
    wh = add.run(wh);
    const flow = (wh.request.input.household.incomeFlows ?? []).at(-1)!;
    return { wh, flow, to: fieldOf(wh, "family", (f) => f.key.endsWith(`${flow.id}/to`)) };
  };

  it("始まり（今月）より前の終わりを打つと、理由を出して書かない。始まりと同じ月は入れられる", () => {
    const { wh, to } = setup();
    const b = wh.request.input.baseMonth;
    const ymText = `${b.slice(0, 4)}年${Number(b.slice(5))}月`;
    expect(typeWhen(to, wh, "2020-04")).toBe(`終わり（2020年4月）が始まり（${ymText}）より前です。始まりの月か、それより後の時点を入れてください`);
    expect(typeof typeWhen(to, wh, wh.request.input.baseMonth)).not.toBe("string");
    expect(typeof typeWhen(to, wh, "2030-03")).not.toBe("string");
  });

  it("入っている終わりが始まりより前なら、欄の下と確かめの一覧に知らせる", () => {
    const { wh, flow, to } = setup();
    const broken = mutate(wh, (h) => {
      const x = (h.incomeFlows ?? []).find((y) => y.id === flow.id)!;
      x.to = { at: "2020-04" };
    });
    const warn = to.get(broken).warn;
    const b = wh.request.input.baseMonth;
    expect(warn).toBe(`終わり（2020年4月）が始まり（${b.slice(0, 4)}年${Number(b.slice(5))}月）より前なので、この期間は計算に入りません。終わりを直してください`);
    expect(checkList(broken).some((r) => r.detail === warn)).toBe(true);
    expect(to.get(wh).warn ?? null).toBeNull();
  });

  it("見本の棚の世帯には、終わりが始まりより前の期間が無い（新しい知らせが出ない）", () => {
    const hits: string[] = [];
    for (const id of MODELS) {
      const wh = open(id);
      for (const f of buildStages(wh).flatMap((s) => allFields(s))) if (f.time !== undefined && (f.get(wh).warn ?? "").includes("が始まり（")) hits.push(`${id} ${f.key}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("生年月: 今月より後と120歳より前は入れない・日つきは日を落として入れる", () => {
  const wh = open("salariedCoupleTwoKids");
  const base = wh.request.input.baseMonth;
  const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
  const birth = fieldOf(wh, "family", (f) => f.key === `family/${self.id}/birth`);
  const o = { ...O, baseMonth: base };

  it("ご本人・配偶者・子の生年月に未来の年月は入れられない（これから生まれる子の足し方を案内する）", () => {
    for (const m of wh.request.input.household.members) {
      const f = fieldOf(wh, "family", (x) => x.key === `family/${m.id}/birth`);
      expect(readField(f, "2028-01", o), m.kind).toBeUndefined();
      expect(rejectReason(f, "2028-01"), m.kind).toBe(`${base.slice(0, 4)}年${Number(base.slice(5))}月より後の年月は入れられません（これから生まれる子は、家族の「＋ これから生まれる子」で足します）`);
      expect(readField(f, base, o), m.kind).toMatchObject({ v: base });
    }
  });

  it("121歳以上の生年月は入れられない（120歳までは入る）", () => {
    expect(rejectReason(birth, "1899-01")).toContain("より前の年月は入れられません");
    expect(readField(birth, "1899-01", o)).toBeUndefined();
    expect(readField(birth, "120歳", o)).toMatchObject({ fromAge: expect.stringContaining("120歳") });
  });

  it("日つき（1980-02-29・1980/2/29・昭和55年2月29日・S55.2.29）は日を落として年月で入れる", () => {
    for (const t of ["1980-02-29", "1980/2/29", "1980.2.29", "1980年2月29日", "昭和55年2月29日", "S55.2.29", "１９８０－０２－２９"]) {
      expect(rejectReason(birth, t), t).toBeNull();
      expect(readField(birth, t, o), t).toEqual({ v: "1980-02", note: "1980年2月として入れました（日は入れません）", warn: null, fromAge: null });
    }
    expect(readField(birth, "1980-04-01", o)?.note).toBe("1980年4月として入れました（1日生まれなら、詳細の「1日生まれ」をオンにしてください）");
  });

  it("ありえない日（平年の2月29日・2月30日・6月31日）は理由を出して止める", () => {
    expect(rejectReason(birth, "1981-02-29")).toBe("1981年2月は28日までです。日を確かめてください");
    expect(rejectReason(birth, "1980-06-31")).toBe("1980年6月は30日までです。日を確かめてください");
    expect(readField(birth, "1980-02-30", o)).toBeUndefined();
    expect(parseDatedYearMonth("1980-02")).toBeNull();
    expect(parseDatedYearMonth("R1.4")).toBeNull();
    expect(parseDatedYearMonth("令和元年5月1日")).toEqual({ ym: "2019-05", day: 1 });
  });

  it("年齢で入れた生年月・年月だけの生年月は前と同じ", () => {
    expect(readField(birth, "1988-05", o)).toEqual({ v: "1988-05", note: null, warn: null, fromAge: null });
    expect(readField(birth, "昭和63年5月", o)).toMatchObject({ v: "1988-05" });
  });
});

describe("収益不動産の空室率・持分・売却の費用は 0〜100%", () => {
  const wh = mutate(open("sampleSeniorRental"), (h) => {
    const a = (h.accounts ?? []).find((x) => x.kind === "realEstate" && x.property !== undefined)!;
    a.property!.sale = { at: { at: "2040-03" } } as NonNullable<NonNullable<typeof a.property>["sale"]>;
  });
  it.each(["/property/vacancy", "/property/share", "/property/saleCost"])("%s", (suffix) => {
    const f = fieldOf(wh, "rental", (x) => x.key.endsWith(suffix));
    expect(rejectReason(f, "120")).toBe("100%より大きい値は設定できません。");
    expect(rejectReason(f, "150")).toBe("100%より大きい値は設定できません。");
    expect(rejectReason(f, "-5")).toBe("0%より小さい値は設定できません。");
    expect(rejectReason(f, "100")).toBeNull();
    expect(readField(f, "120", O)).toBeUndefined();
  });
  it("前提条件の不動産の評価の売却の費用も 0〜100%", () => {
    const f = fieldOf(wh, "assumptions", (x) => x.key === "assume/realEstate/saleCost");
    expect(rejectReason(f, "120")).toBe("100%より大きい値は設定できません。");
  });
});

describe("率の欄は、どこも全角の数字・小数点・マイナス・「％」を読む", () => {
  it("事務所の既定値の率の欄（pctToRate）", () => {
    expect(pctToRate("1.5")).toBe("0.015");
    expect(pctToRate("１．５")).toBe("0.015");
    expect(pctToRate("１.５")).toBe("0.015");
    expect(pctToRate("１．５％")).toBe("0.015");
    expect(pctToRate("－１")).toBe("-0.01");
    expect(pctToRate("−１")).toBe("-0.01");
    expect(pctToRate("２１")).toBeUndefined();
    expect(pctToRate("")).toBeNull();
  });
  it("事務所の推定の値の欄（parseNumber）", () => {
    expect(parseNumber("pct", "１．５％")).toBe("0.015");
    expect(parseNumber("pct", "−１")).toBe("-0.01");
    expect(parseNumber("yen", "１２，０００円")).toBe(12000);
  });
  it("入力の画面の率の欄（rateFromPct）は全角の「％」も読む", () => {
    expect(rateFromPct("１．５％")).toBe("0.015");
    expect(rateFromPct("1.5%")).toBe("0.015");
    expect(rateFromPct("−２")).toBe("-0.02");
  });
});
