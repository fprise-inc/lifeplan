// AI接続口の比べる道具（compare）: 1回で何通りも計算して並べたときの主な数字が、画面の「プランを比べる」の比較の表（plans/compare.ts の
// compareTable・metricsOf）で同じプランを並べたときと同じになるかを、接続口のテスト（crates/lifeplan/tests/mcp_connector.rs の
// compare_matches_the_screen）が確かめるための見本を作る。
// - プランの通り: 画面で見本の世帯を開き、結果のタブのつまみを動かしたプラン（applyValues）を、比較の表に現状と並べたときの数字
// - 重ねる通り: 基本に1つ動かし、通りでもう1つ動かした物（画面で2つのつまみを動かしたプランと同じ）
// - 見本の世帯どうし: 世帯ごとの主な数字（画面でその見本を開いて比較の表を出したときの現状の列）
// 見本を作り直すときは LIFEPLAN_UPDATE_FIXTURES=1 で流す
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { listPlanItems } from "../src/connector/plan.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { candidateRefOf } from "../src/workspace/plans/candidates.ts";
import { compareTable, metricsOf, type PlanMetrics } from "../src/workspace/plans/compare.ts";
import { buildCatalog, type Catalog, type ItemValue } from "../src/workspace/plans/items.ts";
import { applyValues } from "../src/workspace/plans/plans.ts";
import { displayYears, financialOf } from "../src/workspace/present.ts";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const REPO = join(import.meta.dirname, "..", "..");
const FIXTURE = join(REPO, "crates", "lifeplan", "tests", "fixtures", "compare", "expected.json");
const AGE = DEFAULT_DISPLAY_SETTINGS.atAge;

/** 画面と同じく見本の世帯を開いたときの作業中の世帯と動かす項目の一覧（App.tsx の見本を開く所: 見本の定年後の働き方・目盛り） */
function screen(id: string): { req: EngineRequest; wh: WorkingHousehold; cat: Catalog } {
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member.id;
  const demo = demoHousehold(id) ?? null;
  const re = demo?.reemployment;
  const wh = fromRequest(req, re !== undefined ? { postRetirement: { [self]: { ...re, type: re.type as "contract" } } } : {});
  return { req, wh, cat: buildCatalog(wh, self, demo) };
}

type Moves = Record<string, (now: ItemValue) => ItemValue>;
type Change = { target: string; item: string; at?: string[]; lever?: string; value: unknown };
type Listed = { target: string; item: string; at?: string[]; lever?: string; label: string };
const refKey = (x: { target: string; item: string; at?: readonly string[]; lever?: string }) => JSON.stringify([x.target, x.item, x.at ?? null, x.lever ?? null]);

/** 動かす項目のキー → 値の作り方 から、画面のつまみの値と、接続口に渡す同じ変更（一覧の対象・入力項目ID と、場所だけ違う項目は場所。0201）を作る */
function moved(s: ReturnType<typeof screen>, id: string, moves: Moves): { values: Record<string, ItemValue>; changes: Change[] } {
  const listed = (JSON.parse(listPlanItems(JSON.stringify(s.req), JSON.stringify({ sampleId: id, fields: true }), "null")) as { items: Listed[] }).items;
  const values: Record<string, ItemValue> = {};
  const changes: Change[] = [];
  for (const [key, f] of Object.entries(moves)) {
    // 物の ID の所は * で書く（例 loan:*:prepay）
    const re = new RegExp(`^${key.split("*").map((p) => p.replace(/[.:/]/g, "\\$&")).join("[^:]+")}$`);
    const it = s.cat.items.find((x) => re.test(x.key));
    expect(it, `${id} に ${key} がありません`).toBeDefined();
    const v = f(it!.read(s.wh));
    values[it!.key] = v;
    const ref = candidateRefOf(it!, s.wh, s.cat);
    expect(ref, `${id} の ${it!.label} を選べません`).not.toBeNull();
    const l = listed.find((x) => refKey(x) === refKey({ ...ref!, item: it!.item }));
    expect(l, `${id} の一覧に ${it!.label} がありません`).toBeDefined();
    changes.push({ target: l!.target, item: l!.item, ...(l!.at !== undefined ? { at: l!.at } : {}), ...(l!.lever !== undefined ? { lever: l!.lever } : {}), value: v });
  }
  return { values, changes };
}

/** 接続口の keyFigures と同じ形の主な数字（画面の metricsOf の答え） */
const figures = (m: PlanMetrics) => ({
  assetsAtAge: [{ age: m.targetAge, year: m.targetYear, amount: m.target }],
  depletion: m.depletion,
  minimum: { year: m.min.year, amount: m.min.amount },
  lifetimeTakeHome: m.takeHome,
  lifetimeExpense: m.expense,
  loanRepayment: m.loan,
});

/** 画面の表に出す年の、年末の金融資産（年 → 円） */
const financial = (req: EngineRequest, r: PreviewResult) => {
  const fin = financialOf(r.table);
  return Object.fromEntries(displayYears(req).map((y) => [String(y), fin.get(y) ?? 0]));
};

/** 比べるプランの見本（基本の世帯・基本に動かす物・通りごとに動かす物） */
const PLAN_CASES: { name: string; sample: string; base: Moves; variants: { label: string; moves: Moves }[] }[] = [
  {
    name: "対策を3つ並べる",
    sample: "salariedCoupleTwoKids",
    base: {},
    variants: [
      { label: "働く最後の年齢を63歳に", moves: { "lever:retireAge": () => 63 } },
      { label: "年金の受け取りを68歳から・生活費を月28万円・NISA を月3万円", moves: { "lever:pensionAge": () => 68, "lever:livingMonthly": () => 280000, "lever:nisaMonthly": () => 30000 } },
      { label: "配偶者を正社員の年収300万円に・繰上返済300万円", moves: { "spouse:*:work": () => ({ type: "regular", annual: 3000000 }), "loan:*:prepay": () => 3000000 } },
    ],
  },
  {
    name: "基本に重ねる（基本で働く最後の年齢を63歳に、通りで年金の受け取りも動かす）",
    sample: "salariedCoupleTwoKids",
    base: { "lever:retireAge": () => 63 },
    variants: [
      { label: "年金の受け取りを70歳から", moves: { "lever:pensionAge": () => 70 } },
      { label: "生活費を月25万円", moves: { "lever:livingMonthly": () => 250000 } },
    ],
  },
  {
    name: "物価上昇率を振る（入力の欄から作った項目）",
    sample: "sampleSelfEmployedFamily",
    base: {},
    variants: [
      { label: "物価 0%", moves: { "field:assume/inflation": () => "0" } },
      { label: "物価 2%", moves: { "field:assume/inflation": () => "0.02" } },
    ],
  },
  {
    name: "場所だけ違う項目を並べる（0201。資産運用の積立・取り崩し・教育の段階ごとの欄）",
    sample: "salariedCoupleTwoKids",
    base: {},
    variants: [
      { label: "積立を月3万円・55歳でやめる", moves: { "inv:monthly": () => 30000, "inv:stop": () => 55 } },
      { label: "取り崩しを70歳から月10万円", moves: { "inv:wStart": () => 70, "inv:wAmt": () => 100000 } },
      { label: "第2子の大学の学費を年150万円", moves: { "field:edu/*/stage/3/annual": () => 1500000 } },
    ],
  },
];

/** 比べる見本の世帯どうし */
const SAMPLES = ["dualNoKids", "salariedCoupleTwoKids", "single25", "sampleSeniorCouple"];

describe("AI接続口の比べる道具（compare）", () => {
  it("接続口のテストの見本（画面の比較の表で同じプランを並べたときの数字）が今の答えと同じ", () => {
    const plans = PLAN_CASES.map((c) => {
      const s = screen(c.sample);
      const base = moved(s, c.sample, c.base);
      const reqs = [
        { label: "基本", changes: base.changes, req: applyValues(s.wh, base.values, s.cat) },
        ...c.variants.map((v) => {
          const m = moved(s, c.sample, v.moves);
          // 重ねる通り: 画面で基本のつまみと通りのつまみを両方動かしたプラン
          return { label: v.label, changes: m.changes, req: applyValues(s.wh, { ...base.values, ...m.values }, s.cat) };
        }),
      ];
      const results = reqs.map((r) => preview(forEngine(r.req)));
      // 画面の比較の表（基準は1列目）
      const table = compareTable(
        s.req,
        reqs.map((r, i) => ({ name: r.label, table: results[i]!.table })),
        AGE,
        0,
      );
      const depletionDiffs = table.rows.find((r) => r.key === "depletion")!.cells.map((x) => x.diff);
      return {
        name: c.name,
        sample: c.sample,
        columns: reqs.map((r, i) => ({ label: r.label, changes: r.changes, keyFigures: figures(metricsOf(s.req, results[i]!.table, AGE)), financialAssets: financial(s.req, results[i]!) })),
        depletionDiffs,
      };
    });
    const samples = SAMPLES.map((id) => {
      const req = modelHousehold(id);
      const r = preview(forEngine(req));
      return { sample: id, keyFigures: figures(metricsOf(req, r.table, AGE)), financialAssets: financial(req, r) };
    });
    const text = `${JSON.stringify({ atAge: AGE, plans, samples }, null, 2)}\n`;
    if (process.env.LIFEPLAN_UPDATE_FIXTURES !== undefined) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, text);
    }
    expect(readFileSync(FIXTURE, "utf8"), "画面の数字が変わりました。LIFEPLAN_UPDATE_FIXTURES=1 で見本を作り直し、接続口のテスト（cargo test -p lifeplan）も流してください").toBe(text);
  });
});
