// 見本の世帯7件（data/modelHouseholds/sample*.json。架空）: 面談で打ち手（働く最後の年齢・年金の受け取り開始・NISA の積立・生活費）を
// 動かして見せる見本。計算でき、数字が現実的で、打ち手を動かすと最後の金融資産が変わることを確かめる。
// 目盛り・最初の提案などの見本の設定は、見本の一覧（src/workspace/catalog.ts）から読む
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EngineRequest } from "../src/engine/types.ts";
import { DEMO_HOUSEHOLDS, type DemoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { addMonths, ageReachedMonth, applyLevers, LEVER_KEYS, readLevers } from "../src/workspace/levers.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues, normalizeValues } from "../src/workspace/plans/plans.ts";
import { financialOf } from "../src/workspace/present.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

/** 2026-10-21 に足した見本（見本の一覧から） */
const SAMPLES: readonly DemoHousehold[] = DEMO_HOUSEHOLDS.filter((d) => d.id.startsWith("sample"));

const TRAITS = new Set(["会社員", "公務員", "自営業", "役員", "年金生活", "共働き", "片働き", "持ち家", "賃貸", "住宅ローン", "教育費", "資産運用"]);
/** 既存の見本の番号（夫婦と子・40代の3件と、夫婦と子・30代の1件） */
const TAKEN = ["3-4-01", "3-4-02", "3-4-03", "3-3-01"];
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 要求の中の ID（members・物の id） */
function idsOf(req: EngineRequest): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string | null) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, null));
    else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
    else if (key === "id" && typeof v === "string") out.push(v);
  };
  walk(req.input.household, null);
  return out;
}

const finalOf = (req: EngineRequest) => {
  const fin = financialOf(preview(req).table);
  return fin.get(req.input.endYear) as number;
};

describe("見本の番号と絞り込みの項目", () => {
  it("番号は 家族の形-本人の年代-順番 の形で、重ならない（既存の見本の番号とも）", () => {
    const nos = SAMPLES.map((s) => s.sampleNo);
    for (const n of nos) expect(n).toMatch(/^[1-5]-[2-7]-\d{2}$/);
    expect(new Set([...nos, ...TAKEN]).size).toBe(nos.length + TAKEN.length);
    for (const s of SAMPLES) {
      const req = modelHousehold(s.id);
      const self = req.input.household.members.find((m) => m.kind === "self")!;
      const age = 2026 - Number(self.birth.birthYearMonth.slice(0, 4)) - (Number(self.birth.birthYearMonth.slice(5)) > 10 ? 1 : 0);
      expect(Number(s.sampleNo.split("-")[1]), s.id).toBe(Math.floor(age / 10));
    }
  });

  it("絞り込みの項目は決まった語から選ぶ", () => {
    for (const s of SAMPLES) for (const t of s.traits) expect(TRAITS.has(t), `${s.id}: ${t}`).toBe(true);
  });
});

describe.each(SAMPLES)("$id（$title）", (s) => {
  const req = modelHousehold(s.id);
  const h = req.input.household;
  const self = h.members.find((m) => m.kind === "self")!;
  const birthYear = Number(self.birth.birthYearMonth.slice(0, 4));
  const opts = s.reemployment !== undefined ? { reemployment: s.reemployment } : {};
  const now = readLevers(req, self.id);
  const base = finalOf(req);

  it("架空の世帯（氏名・連絡先の欄を持たない）。ID は UUID 第4版で、ほかのモデル世帯と重ならない", () => {
    expect(JSON.stringify(req)).not.toMatch(/"(name|fullName|kana|address|phone|email)"/);
    const mine = idsOf(req);
    for (const id of mine) expect(id).toMatch(UUID4);
    expect(new Set(mine).size).toBe(mine.length);
    const others = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
      .filter((f) => f.endsWith(".json") && f !== `${s.id}.json`)
      .flatMap((f) => idsOf(modelHousehold(f.replace(/\.json$/, ""))));
    const set = new Set(others);
    for (const id of mine) expect(set.has(id), id).toBe(false);
  });

  it("計算基準月は2026年10月、表は本人の95歳の年まで", () => {
    expect(req.input.baseMonth).toBe("2026-10");
    expect(req.input.endYear).toBe(birthYear + s.targetAge);
  });

  it("打ち手4つが世帯から読め、現状の値は目盛りの中にある。最初の提案は現状と違い、目盛りの範囲の中", () => {
    expect(Object.keys(now).sort()).toEqual([...LEVER_KEYS].sort());
    for (const k of LEVER_KEYS) {
      const v = now[k]!;
      expect(v, k).toBeGreaterThanOrEqual(Math.min(...s.steps[k]));
      expect(v, k).toBeLessThanOrEqual(Math.max(...s.steps[k]));
      const p = s.firstProposal[k];
      if (p !== undefined) {
        expect(p, k).toBeGreaterThanOrEqual(Math.min(...s.steps[k]));
        expect(p, k).toBeLessThanOrEqual(Math.max(...s.steps[k]));
      }
    }
    expect(LEVER_KEYS.some((k) => s.firstProposal[k] !== undefined && s.firstProposal[k] !== now[k])).toBe(true);
    // 年齢の打ち手は、まだ来ていない月に当たる（過ぎた月に働き方・年金を動かさない）
    for (const k of ["retireAge", "pensionAge"] as const) {
      for (const a of s.steps[k]) expect(addMonths(ageReachedMonth(self, a), k === "retireAge" ? -1 : 1) >= req.input.baseMonth, `${k} ${a}`).toBe(true);
    }
  });

  it("現状の数字が現実的: 本人の95歳の年に金融資産が残り、資金の不足が出ない", () => {
    expect(base).toBeGreaterThan(0);
    expect(preview(req).table.some((c) => c.row === "cf.balance.shortfall" && c.amount > 0)).toBe(false);
  });

  it("生活費を下げると、最後の金融資産が増える", () => {
    const lower = Math.min(...s.steps.livingMonthly);
    expect(lower).toBeLessThan(now.livingMonthly!);
    expect(finalOf(applyLevers(req, self.id, { livingMonthly: lower }, opts))).toBeGreaterThan(base);
  });

  it("NISA の積立を増やすと最後の金融資産が増え、やめると減る", () => {
    const more = Math.max(...s.steps.nisaMonthly);
    expect(more).toBeGreaterThan(now.nisaMonthly!);
    expect(finalOf(applyLevers(req, self.id, { nisaMonthly: more }, opts))).toBeGreaterThan(base);
    expect(finalOf(applyLevers(req, self.id, { nisaMonthly: 0 }, opts))).toBeLessThan(base);
  });

  it("働く最後の年齢を延ばすと最後の金融資産が増え、早めると減る（今が目盛りの最小なら延ばす側だけ）", () => {
    const later = Math.max(...s.steps.retireAge);
    const earlier = Math.min(...s.steps.retireAge);
    expect(later).toBeGreaterThan(now.retireAge!);
    expect(finalOf(applyLevers(req, self.id, { retireAge: later }, opts))).toBeGreaterThan(base);
    if (earlier < now.retireAge!) expect(finalOf(applyLevers(req, self.id, { retireAge: earlier }, opts))).toBeLessThan(base);
  });

  it("年金の受け取り開始を動かすと、最後の金融資産が変わる", () => {
    const other = s.steps.pensionAge.filter((a) => a !== now.pensionAge);
    expect(other.length).toBeGreaterThan(0);
    for (const a of other) expect(finalOf(applyLevers(req, self.id, { pensionAge: a }, opts)), String(a)).not.toBe(base);
  });

  it("最初の提案は計算でき、結果が現状と違い、資金の不足が出ない", () => {
    const r = preview(applyLevers(req, self.id, s.firstProposal, opts));
    expect(financialOf(r.table).get(req.input.endYear)).not.toBe(base);
    expect(r.table.some((c) => c.row === "cf.balance.shortfall" && c.amount > 0)).toBe(false);
  });

  it.runIf(s.plans !== undefined)("入れておくプランは打ち手の項目で、どれも現状と違う結果になる", () => {
    const re = s.reemployment;
    const wh = fromRequest(req, { memo: s.memo, ...(re !== undefined ? { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } } : {}) });
    const cat = buildCatalog(wh, self.id, s);
    for (const p of s.plans ?? []) {
      for (const k of Object.keys(p.values)) expect(cat.byKey.has(k), `${p.name}: ${k}`).toBe(true);
      const values = normalizeValues(p.values, {}, wh, cat);
      expect(Object.keys(values).length, p.name).toBeGreaterThan(0);
      expect(finalOf(applyValues(wh, values, cat)), p.name).not.toBe(base);
    }
  });
});
