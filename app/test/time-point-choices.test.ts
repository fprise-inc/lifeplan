// 時点の部品（0038 の追記 2026-11-02）: 「出来事から」の選択肢の見せ方（年月は1つ・年月の順・欄に合わない物は出さない・同じ名前の区別）と、
// 「今から」（○年後）を入れ方に出す欄
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import type { Residence } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { eventChoices } from "../src/workspace/input/namedEvents.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { DEFAULT_WHEN_MODES, eventOptionText, parseWhen, showWhen, WHEN_MODE_LABEL } from "../src/workspace/input/when.ts";
import { resolveTimepoint } from "../src/workspace/timepoint.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string) => fromRequest(modelHousehold(id));
const fields = (wh: WorkingHousehold) => buildStages(wh).flatMap((s) => allFields(s));
const byKey = (wh: WorkingHousehold, key: string) => fields(wh).find((f) => f.key === key) as FieldDef;
const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));
const YM = /\d{4}年\d{1,2}月/g;

const BUY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** 今の持ち家（入居は出来事）に 2028年9月まで住み、2028年10月に買った家（住宅の購入）に移る世帯 */
function buying(): WorkingHousehold {
  const wh = open("salariedCoupleTwoKids");
  return mutate(wh, (h) => {
    const cur = h.residences![0]! as { to: unknown };
    cur.to = { at: "2028-09" };
    const next: Residence = { id: BUY, kind: "own", from: { at: "2028-10" }, to: null, purchase: { at: { at: "2028-10" }, price: 50_000_000, downPayment: 5_000_000, costs: 2_000_000 } };
    h.residences!.push(next);
  });
}

describe("「出来事から」の選択肢", () => {
  it("住み終わりの欄: その住まい自身の入居と、住み始めより前の出来事は出さない。年月の順で、年月は1つだけ", () => {
    const wh = buying();
    const st = byKey(wh, `housing/res/${BUY}/to`).time!.state(wh);
    const texts = st.ctx.events.map(eventOptionText);
    // 自分の入居（住宅の購入）・前の住まいの入居（2016年）は出さない
    expect(texts.some((t) => t.includes("住宅の購入"))).toBe(false);
    expect(texts.some((t) => t.includes("住まい 1"))).toBe(false);
    expect(st.ctx.events.every((e) => e.ym === null || e.ym >= "2028-10")).toBe(true);
    // 子の独立・年金の受け取り開始は残る（年月の順）
    expect(texts).toContain("第1子の独立（2035年4月）");
    expect(texts).toContain("第2子の独立（2038年4月）");
    const yms = st.ctx.events.map((e) => e.ym ?? "9999-99");
    expect(yms).toEqual([...yms].sort());
    for (const t of texts) expect(t.match(YM)?.length ?? 0, t).toBeLessThanOrEqual(1);
    for (const t of texts) expect(t).not.toContain("選ぶと出来事");
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("同じ名前の出来事（入居が2つ）は、元の入力項目の呼び方で分ける。前の住まいの住み終わりには、買った家の入居を出す", () => {
    const wh = buying();
    const h = wh.request.input.household;
    const first = h.residences![0]!;
    const all = eventChoices(wh).filter((e) => e.names.includes("入居"));
    expect(all.map((e) => e.label).sort()).toEqual(["入居（住まい 1）", "入居（住宅の購入）"]);
    expect(all.map(eventOptionText).sort()).toEqual(["入居（住まい 1・2016年4月）", "入居（住宅の購入・2028年10月）"]);
    // 前の住まい（住み始めは入居の出来事）の住み終わり: 自分の入居は出さず、買った家の入居は出す
    const st = byKey(wh, `housing/res/${first.id}/to`).time!.state(wh);
    const texts = st.ctx.events.map(eventOptionText);
    expect(texts).toContain("入居（住宅の購入・2028年10月）");
    expect(texts.some((t) => t.includes("住まい 1"))).toBe(false);
    // 購入の1件には住み始めの欄を出さない（購入の時期に住み始める。0052 の追記 2026-11-07）
    expect(byKey(wh, `housing/res/${BUY}/from`)).toBeUndefined();
  });

  it("分けた名前で打っても、見せた文字を打ち直しても同じ時点に読む（全角のかっこ）", () => {
    const wh = buying();
    const f = byKey(wh, `housing/res/${wh.request.input.household.residences![0]!.id}/to`);
    const st = f.time!.state(wh);
    const buy = st.ctx.events.find((e) => e.label === "入居（住宅の購入）")!;
    const r = parseWhen("入居（住宅の購入）の前月", st.ctx);
    expect(r).toMatchObject({ ok: true, tp: { event: buy.id, offset: { months: -1 } } });
    const shown = showWhen({ event: buy.id, offset: { months: -1 } }, { ...st.ctx, mode: "event" });
    expect(shown).toBe("入居（住宅の購入）の前月");
    expect(parseWhen(shown, st.ctx)).toMatchObject({ ok: true, tp: { event: buy.id, offset: { months: -1 } } });
    // 選ぶと出来事にし、住み終わりはその出来事を指す。結果は年月で入れたときと同じ
    const w1 = f.time!.setWhen(wh, { event: buy.id, offset: { months: -1 } }, "this");
    const h1 = w1.request.input.household;
    expect(resolveTimepoint(h1, h1.residences![0]!.to)).toBe("2028-09");
    expect(h1.residences![1]!.from.event).toBeDefined();
  });

  it("今指している出来事は、欄の決まりで絞っても選択肢に残す", () => {
    const wh = buying();
    const h = wh.request.input.household;
    const moveIn = h.events![0]!;
    // 買った家の住み終わりが、前の住まいの入居（買った家の住み始めより前）から決まっている前の値
    const w1 = mutate(wh, (hh) => void ((hh.residences![1]! as { to: unknown }).to = { event: moveIn.id, offset: { years: 30 } }));
    const st = byKey(w1, `housing/res/${BUY}/to`).time!.state(w1);
    expect(st.ctx.events.some((e) => e.id === moveIn.id)).toBe(true);
    expect(showWhen(st.raw, st.ctx)).toBe("入居（住まい 1）から30年後");
  });

  it.each(MODELS)("どの欄も、年月は1つ・年月の順・内部の言い方を出さない: %s", (id) => {
    const wh = open(id);
    for (const f of fields(wh)) {
      if (f.time === undefined) continue;
      const st = f.time.state(wh);
      const texts = st.ctx.events.map(eventOptionText);
      for (const t of texts) {
        expect(t.match(YM)?.length ?? 0, `${f.key}: ${t}`).toBeLessThanOrEqual(1);
        expect(t, f.key).not.toContain("選ぶと出来事");
      }
      expect(new Set(texts).size, f.key).toBe(texts.length);
      const yms = st.ctx.events.map((e) => e.ym ?? "9999-99");
      expect(yms, f.key).toEqual([...yms].sort());
      const start = st.ctx.start != null ? resolveTimepoint(wh.request.input.household, st.ctx.start) : null;
      if (start !== null) for (const e of st.ctx.events) if (e.id !== st.raw?.event) expect(e.ym === null || e.ym >= start, `${f.key}: ${e.label}`).toBe(true);
    }
  });
});

describe("「今から」（○年後）", () => {
  it("住み終わりなど、欄が入れ方を決めない欄には出さない。「5年後」と打てば年月に読む", () => {
    const wh = buying();
    const f = byKey(wh, `housing/res/${BUY}/to`);
    const st = f.time!.state(wh);
    expect(st.ctx.modes).toEqual(DEFAULT_WHEN_MODES);
    expect(st.ctx.modes).not.toContain("now");
    expect(parseWhen("5年後", st.ctx)).toMatchObject({ ok: true, tp: { at: "2031-10" } });
    expect(parseWhen("今から10年後", st.ctx)).toMatchObject({ ok: true, tp: { at: "2036-10" } });
    const w1 = f.set(wh, { at: "2031-10" });
    expect(w1.request.input.household.residences![1]!.to).toEqual({ at: "2031-10" });
    expect(f.get(w1).when!.read).toContain("今から5年後");
  });

  it("働き方・出来事の時点の欄も入れ方に出さない。○年後を既定にする車の時期だけ「○年後」で出す", () => {
    for (const id of MODELS) {
      const wh = open(id);
      for (const f of fields(wh)) {
        if (f.time === undefined || !f.time.when.modes.includes("now")) continue;
        expect(f.time.when.defaultMode, `${id} ${f.key}`).toBe("now");
        expect(f.key, id).toMatch(/(^|\/)car\//);
      }
    }
    expect(WHEN_MODE_LABEL.now).toBe("○年後");
  });

  it("前の値（今から○年後で入れた年月）は、入れ方に「○年後」の無い欄でも年月で読めて見せられる", () => {
    const wh = buying();
    const w1 = mutate(wh, (hh) => void ((hh.residences![1]! as { to: unknown }).to = { at: "2036-10" }));
    const f = byKey(w1, `housing/res/${BUY}/to`);
    const st = f.time!.state(w1);
    expect(st.raw).toEqual({ at: "2036-10" });
    expect(showWhen(st.raw, st.ctx)).toBe("2036-10");
    expect(st.read).toContain("今から10年後");
    expect(f.get(w1).value).toBe("2036-10");
  });
});
