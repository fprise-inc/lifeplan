// 空欄の推定の値を欄の中に灰色で見せる（0041 の追記 2026-11-10）: 空欄のまま推定で計算する欄で推定の値を書ける欄（blankEstimate）は、
// 欄の中に「空欄＝推定」でなく推定の値そのもの（「5.2」「47.2」「55」）を灰色で出し、「この値にする」を欄の中に置き、欄の横は値の繰り返しでなく根拠の短い文。
// 推定の値を書けない欄（積立をやめる年齢など）・空欄の意味が値でない欄（「空欄＝65歳から」など）は今のまま。
// 介護の目安の物の期間は空欄＝統計の平均の推定（前は統計の月数を入れた値として書いていた）
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { Field, FieldStateOps } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { fillAll } from "../src/workspace/input/fill.ts";
import { shortBasis } from "../src/workspace/input/placeholder.ts";
import { addOutside, careSpan } from "../src/workspace/input/stages/care.ts";
import { buildStage, STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, availableOps, fieldStatus } from "../src/workspace/input/valueState.ts";
import { careEstimate } from "../../hearing/src/estimates.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const BASE = "2026-10";
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const noop = () => undefined;
const fieldHtml = (wh: WorkingHousehold, f: FieldDef) => renderToString(h(FieldStateOps.Provider, { value: applyStateOp }, h(Field, { f, wh, onEdit: noop })));
const inputOf = (html: string): string => /<input\b[^>]*>/.exec(html)?.[0] ?? "";
const placeholderOf = (html: string): string | undefined => /placeholder="([^"]*)"/.exec(inputOf(html))?.[1];
const careField = (wh: WorkingHousehold, id: string, part: string): FieldDef => {
  const f = allFields(buildStage("care", wh)).find((x) => x.key === `ev/care/${id}/${part}`);
  if (f === undefined) throw new Error(`no field ${part}`);
  return f;
};
/** 親を1人足し、その人の介護の目安を入れた世帯 */
function withCare(): { wh: WorkingHousehold; id: string } {
  let wh = addOutside(blankHousehold(BASE, seq()), "parent");
  const p = wh.request.input.household.members.find((m) => m.kind === "parent")!;
  const a = buildStage("care", wh)
    .sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])
    .find((x) => x.key === `family/${p.id}/care/estimate`)!;
  wh = a.run(wh);
  return { wh, id: wh.request.input.household.careExpenses![0]!.id };
}

describe("根拠の短い文（shortBasis）", () => {
  it("調査の名前のある根拠は「統計の平均（○○の調査）」、「統計の平均」で始まる根拠は「統計の平均」、短い根拠はそのまま、ほかは出さない", () => {
    expect(shortBasis("推定（生命保険文化センター「生命保険に関する全国実態調査」2024年度の平均（在宅））")).toBe("統計の平均（生命保険文化センターの調査）");
    expect(shortBasis("統計の平均。学校教育費と給食費を足したもの（文部科学省「子供の学習費調査」令和5年度）")).toBe("統計の平均（文部科学省の調査）");
    expect(shortBasis("統計の平均の仕送り（日本政策金融公庫「教育費負担の実態調査」令和3年度。年95.8万円を12で割った額）")).toBe("統計の平均（日本政策金融公庫の調査）");
    expect(shortBasis("統計の平均の入学料（私立大学・理科系・令和7年度入学者）")).toBe("統計の平均");
    expect(shortBasis("退職の年（60歳）")).toBe("退職の年（60歳）");
    expect(shortBasis("入れていないので、給与（賞与を除く年収÷12）と通勤手当の月額から等級表で決めて計算しています")).toBeNull();
    expect(shortBasis(null)).toBeNull();
  });
});

describe("介護の費用の欄: 空欄の推定の値を灰色で", () => {
  it("月々の費用・一時費用・期間は、欄の中に推定の値（「空欄＝推定」ではない）、「この値にする」は欄の中、欄の横は根拠の短い文", () => {
    const { wh, id } = withCare();
    const est = careEstimate("home")!;
    const cases: [string, string][] = [
      ["other", (est.monthly / 10000).toFixed(1)],
      ["initial", (est.initial / 10000).toFixed(1)],
      ["months", String(est.months)],
    ];
    for (const [part, text] of cases) {
      const f = careField(wh, id, part);
      expect(f.get(wh).value).toBeNull();
      expect(fieldStatus(f, wh).status).toBe("estimated");
      const html = fieldHtml(wh, f);
      expect(placeholderOf(html)).toBe(text);
      expect(inputOf(html)).toMatch(/class="num has-fill est-ghost"/);
      // 欄そのものは空（打ち始めると灰色の値は消える）
      expect(inputOf(html)).toMatch(/ value(="")?[ />]/);
      expect(html).not.toContain("空欄＝推定");
      // 「この値にする」は欄の中（灰色の値の左）に1つ、名前の横に「推定」の印
      expect(html).toMatch(/<span class="fld-box"><input [^>]*\/><button type="button" class="fld-fill inside"[^>]*data-fill-estimate="true">この値にする<\/button><\/span>/);
      expect(html).toContain('<div class="fld is-est"');
      expect(html).toMatch(/>推定</);
      // 欄の横は値の繰り返し（「月5.2万円（推定）」）でなく根拠の短い文
      expect(html).toContain('<span class="fld-hint">統計の平均（生命保険文化センターの調査）</span>');
      expect(html).not.toContain(`${text}万円（推定）`);
      expect(html).not.toContain("か月（推定）");
    }
  });

  it("「この値にする」で推定の値を書いて確定（推定の根拠は行に残す）。確定の値は黒字で、「推定に戻す」で空欄（推定）に戻る", () => {
    const { wh, id } = withCare();
    const est = careEstimate("home")!;
    for (const [part, value] of [
      ["other", est.monthly],
      ["initial", est.initial],
      ["months", est.months],
    ] as const) {
      const f = careField(wh, id, part);
      expect(availableOps(f, wh)).toContain("confirm");
      const next = applyStateOp(wh, f, "confirm");
      expect(f.get(next).value).toBe(value);
      expect(fieldStatus(f, next).status).toBe("confirmed");
      const html = fieldHtml(next, f);
      expect(inputOf(html)).not.toContain("est-ghost");
      expect(html).not.toContain("data-fill-estimate");
      expect(availableOps(f, next)).toContain("revert");
      const back = applyStateOp(next, f, "revert");
      expect(f.get(back).value).toBeNull();
      expect(fieldStatus(f, back).status).toBe("estimated");
    }
  });
});

describe("介護の期間の推定", () => {
  it("介護の目安の物は期間を空欄（推定）で持ち、見出しの下の1行は期間と月額の両方に「（推定）」", () => {
    const { wh, id } = withCare();
    const c = wh.request.input.household.careExpenses![0]!;
    expect(c.months).toBeUndefined();
    expect(careSpan(wh, c)).toMatch(new RegExp(`^在宅・\\d{4}年\\d{1,2}月から${careEstimate("home")!.months}か月（推定）・月5\\.2万円（推定）$`));
    // 期間を入れたら期間の「（推定）」は消える（月額は推定のまま）
    const typed = applyStateOp(wh, careField(wh, id, "months"), "confirm");
    expect(careSpan(typed, typed.request.input.household.careExpenses![0]!)).toMatch(/か月・月5\.2万円（推定）$/);
  });

  it("前の版で期間を数で持っている介護の物（推定で入れた物か FP が入れた物か区別できない）は、入れた値のまま（黒字・印なし）。「推定に戻す」で推定にできる", () => {
    const { wh, id } = withCare();
    const old = mutate(wh, (h) => void (h.careExpenses![0]!.months = 30));
    const f = careField(old, id, "months");
    expect(f.get(old).value).toBe(30);
    expect(fieldStatus(f, old).status).toBe("confirmed");
    const html = fieldHtml(old, f);
    expect(inputOf(html)).toMatch(/value="30"/);
    expect(inputOf(html)).not.toContain("est-ghost");
    expect(html).toContain('data-op="revert"');
    expect(careSpan(old, old.request.input.household.careExpenses![0]!)).toMatch(/から30か月・/);
    const back = applyStateOp(old, f, "revert");
    expect(back.request.input.household.careExpenses![0]!.months).toBeUndefined();
    expect(fieldStatus(f, back).status).toBe("estimated");
  });

  it("期間が亡くなる見込みで止まるときは、根拠の短い文の後ろにその1行", () => {
    const { wh, id } = withCare();
    const near = mutate(wh, (h) => {
      const p = h.members.find((m) => m.kind === "parent")!;
      p.leaves = { at: "2030-01" };
      h.careExpenses![0]!.from = { at: "2027-01" };
    });
    const html = fieldHtml(near, careField(near, id, "months"));
    expect(html).toContain("統計の平均（生命保険文化センターの調査）。亡くなる見込みで止まり、2029年12月まで（費用は36か月分）");
  });
});

describe("ほかの推定の欄（推定の値を書ける欄）も灰色の値にそろう", () => {
  const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5));
  const households = (): [string, WorkingHousehold][] => [
    ["空の世帯", fillAll(blankHousehold(BASE, seq())).wh],
    ...MODELS.flatMap((m) => {
      const w = fromRequest(modelHousehold(m), {});
      return [
        [m, w],
        [`${m}（推定で入れた後）`, fillAll(w).wh],
      ] as [string, WorkingHousehold][];
    }),
  ];

  it("空欄で推定の値を書ける数の欄は、どの見本の世帯でも欄の中に推定の値（「空欄＝推定」を出さない）。書けない推定・空欄の意味が値でない欄は今のまま", () => {
    const ghosted = new Set<string>();
    const kept = new Set<string>();
    for (const [name, wh] of households())
      for (const s of STAGE_ORDER)
        for (const f of allFields(buildStage(s.id, wh))) {
          if (f.readOnly !== undefined || f.kind === "select" || f.kind === "bool" || f.kind === "when" || f.kind === "text" || f.time !== undefined) continue;
          const st = f.get(wh);
          if (st.value !== null || fieldStatus(f, wh).status !== "estimated") continue;
          const html = fieldHtml(wh, f);
          const ph = placeholderOf(html) ?? "";
          const v = f.blankMeans === undefined ? (f.blankEstimate?.(wh) ?? null) : null;
          if (v !== null) {
            ghosted.add(`${s.label}: ${f.label}`);
            expect(ph, `${name} ${s.label} ${f.label}`).not.toContain("空欄＝");
            expect(ph, `${name} ${s.label} ${f.label}`).toMatch(/^[\d,.]+$/);
            expect(inputOf(html), `${name} ${s.label} ${f.label}`).toContain("est-ghost");
          } else {
            kept.add(`${s.label}: ${f.label}`);
            expect(inputOf(html)).not.toContain("est-ghost");
          }
        }
    // 洗い出した欄（0041 の追記 2026-11-10 の一覧と同じ）
    expect([...ghosted].sort()).toEqual(
      [
        "介護・親: 一時費用",
        "介護・親: 月々の費用（自己負担の合計）",
        "介護・親: 期間",
        "働き方と収入: 標準報酬月額（健康保険）",
        "働き方と収入: 標準報酬月額（厚生年金）",
        "子ども・教育: うち部活動など（年額）",
        "子ども・教育: 保育料とは別にかかるお金（年額）",
        "子ども・教育: 入学金",
        "子ども・教育: 在学年数",
        "子ども・教育: 学校の費用（年額）",
        "子ども・教育: 学校外の費用（月額）",
        "子ども・教育: 学費（年額）",
        "子ども・教育: 自宅外の仕送り（月額）",
        "子ども・教育: 自宅外の初期費用",
        "貯蓄・運用: 受け取りを始める年齢",
      ].sort(),
    );
    expect(kept.size).toBeGreaterThan(0);
  });

  it("推定の値を書けない欄（積立をやめる年齢の空欄＝退職の年まで）は「空欄＝推定」のまま", () => {
    for (const [, wh] of households()) {
      const f = allFields(buildStage("savings", wh)).find((x) => x.label.startsWith("積立をやめる年齢") && x.get(wh).value === null && fieldStatus(x, wh).status === "estimated");
      if (f === undefined) continue;
      const html = fieldHtml(wh, f);
      expect(placeholderOf(html)).toBe("空欄＝推定");
      expect(inputOf(html)).not.toContain("est-ghost");
      return;
    }
    throw new Error("積立をやめる年齢の空欄の欄が見本に無い");
  });
});

describe("見た目", () => {
  it("灰色の値は、入っている推定の値と同じ文字の色（明るい・暗いとも --base-ink。プレースホルダーの既定の薄さにしない）", () => {
    const css = readFileSync(join(REPO_DIR, "app", "src", "styles", "app.css"), "utf8");
    expect(css).toContain(".fld-c input.est-ghost::placeholder { color: var(--base-ink); opacity: 1; }");
    expect(css).toMatch(/\.fld\.is-est \.fld-c input\[type="text"\] \{ border-style: dashed;/);
  });
});
