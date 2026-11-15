// 推定の出どころの出し方: 推定の出どころ（「統計の平均（○○の調査）」など）は欄の横に常に出さず、「推定」の印の吹き出しの頭（「推定のもと: …」）に
// まとめる。入れ方・計算の中身の一言（「学校の費用に含まれます」「亡くなる見込みで止まり、…」「資格の予備校などがあれば入れます」）は欄の横のまま。
// FP が値を入れて推定でなくなった欄には、印も出どころも出さない
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { Field, FieldStateOps, StateMark } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { fillAll } from "../src/workspace/input/fill.ts";
import { estimateBasisLines, shortBasis, splitEstimateHint } from "../src/workspace/input/placeholder.ts";
import { buildStage, STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, fieldStatus, typeValue } from "../src/workspace/input/valueState.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const BASE = "2026-10";
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const noop = () => undefined;
const fieldHtml = (wh: WorkingHousehold, f: FieldDef) => renderToString(h(FieldStateOps.Provider, { value: applyStateOp }, h(Field, { f, wh, onEdit: noop })));
/** 欄の横の1行（数の欄の hint と時点の欄の note） */
const sideLines = (html: string): string[] => [...html.matchAll(/<span class="fld-hint"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1] ?? "");
/** 推定の出どころの言い方（欄の横に出さない物） */
const SOURCE = /^(統計の平均|事務所の推定の値|推定あり: |推定: )/;

describe("出どころと残す一言の分け方（splitEstimateHint）", () => {
  it("「統計の平均（○○の調査）」「事務所の推定の値」で始まる1行は、そこまでが出どころ、続く「・」「。」の後ろが欄の横に残す一言", () => {
    expect(splitEstimateHint("統計の平均（日本政策金融公庫の調査）")).toEqual({ source: "統計の平均（日本政策金融公庫の調査）", rest: null });
    expect(splitEstimateHint("統計の平均")).toEqual({ source: "統計の平均", rest: null });
    expect(splitEstimateHint("統計の平均（文部科学省の調査）・学校の費用に含む")).toEqual({ source: "統計の平均（文部科学省の調査）", rest: "学校の費用に含む" });
    expect(splitEstimateHint("統計の平均・学校の費用に含まれます")).toEqual({ source: "統計の平均", rest: "学校の費用に含まれます" });
    expect(splitEstimateHint("統計の平均（生命保険文化センターの調査）。亡くなる見込みで止まり、2029年12月まで（費用は36か月分）")).toEqual({ source: "統計の平均（生命保険文化センターの調査）", rest: "亡くなる見込みで止まり、2029年12月まで（費用は36か月分）" });
    expect(splitEstimateHint("事務所の推定の値")).toEqual({ source: "事務所の推定の値", rest: null });
  });
  it("ほかの1行は全部が出どころ（推定の根拠の短い文）", () => {
    expect(splitEstimateHint("今の年収から等級表で（毎年9月に決め直す）")).toEqual({ source: "今の年収から等級表で（毎年9月に決め直す）", rest: null });
    expect(splitEstimateHint("統計の平均の入学料")).toEqual({ source: "統計の平均の入学料", rest: null });
    expect(splitEstimateHint(undefined)).toEqual({ source: null, rest: null });
    expect(splitEstimateHint(null)).toEqual({ source: null, rest: null });
  });
});

describe("吹き出しの文（estimateBasisLines）", () => {
  it("頭は「推定のもと: 出どころ」。根拠が同じ中身（出どころで始まる）なら重ねずに1行", () => {
    expect(estimateBasisLines("統計の平均（日本政策金融公庫「教育費負担の実態調査」令和3年度の大学の入学者）", "統計の平均（日本政策金融公庫の調査）")).toEqual(["推定のもと: 統計の平均（日本政策金融公庫の調査）", "統計の平均（日本政策金融公庫「教育費負担の実態調査」令和3年度の大学の入学者）"]);
    expect(estimateBasisLines("統計の平均の入学料（私立大学・令和7年度入学者）")).toEqual(["推定のもと: 統計の平均の入学料（私立大学・令和7年度入学者）"]);
    expect(estimateBasisLines("退職の年（60歳）")).toEqual(["推定のもと: 退職の年（60歳）"]);
    // 出どころが欄の横から移した文でなくても、根拠から短い文を作れれば頭に置く
    expect(estimateBasisLines("統計の平均。学校教育費と給食費を足したもの（文部科学省「子供の学習費調査」令和5年度）")).toEqual(["推定のもと: 統計の平均（文部科学省の調査）", "統計の平均。学校教育費と給食費を足したもの（文部科学省「子供の学習費調査」令和5年度）"]);
  });
  it("「推定（…）」と全体を包んだ根拠は中身だけ（「推定のもと: 推定（」と重ねない）", () => {
    expect(estimateBasisLines("推定（生命保険文化センター「生命保険に関する全国実態調査」2024年度の平均（在宅））", "統計の平均（生命保険文化センターの調査）")).toEqual(["推定のもと: 統計の平均（生命保険文化センターの調査）", "生命保険文化センター「生命保険に関する全国実態調査」2024年度の平均（在宅）"]);
    expect(estimateBasisLines("推定（前の段階の終わりの翌月。前の段階の始まりに、その期間（24か月）を足しています）", "前の段階の終わりの翌月")).toEqual(["推定のもと: 前の段階の終わりの翌月。前の段階の始まりに、その期間（24か月）を足しています"]);
    // 包んでいない（「推定（A）。B（C）」）なら、そのまま
    expect(estimateBasisLines("推定（A）。B（C）")[0]).toBe("推定のもと: 推定（A）。B（C）");
  });
  it("印の吹き出しの頭に置く", () => {
    const html = renderToString(h(StateMark, { status: "estimated", basis: "統計の平均（日本政策金融公庫「教育費負担の実態調査」令和3年度）", text: "推定", label: "自宅外の仕送り", source: "統計の平均（日本政策金融公庫の調査）" }));
    expect(html).toContain('<p class="est-basis" data-basis="true"><span class="est-src" data-est-head="true">推定のもと: 統計の平均（日本政策金融公庫の調査）</span><br/>統計の平均（日本政策金融公庫「教育費負担の実態調査」令和3年度）</p>');
  });
});

describe("どの入力項目でも、推定の出どころは欄の横に出さない", () => {
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

  it("推定の欄は、欄の横に出どころを出さず、印の吹き出しの頭に「推定のもと: …」。前に欄の横に出していた出どころは吹き出しに入っている", () => {
    const moved = new Set<string>();
    for (const [name, wh] of households())
      for (const s of STAGE_ORDER)
        for (const f of allFields(buildStage(s.id, wh))) {
          const html = fieldHtml(wh, f);
          const where = `${name} ${s.label} ${f.label}`;
          for (const line of sideLines(html)) expect(line, where).not.toMatch(SOURCE);
          if (fieldStatus(f, wh).status !== "estimated" || f.readOnly !== undefined) continue;
          const st = f.get(wh);
          // 前に欄の横に出していた1行（blankHint。無ければ根拠から作る短い文）
          const before = st.blankHint !== undefined ? st.blankHint : shortBasis(fieldStatus(f, wh).basis);
          const { source, rest } = splitEstimateHint(before);
          if (source !== null && st.value === null && f.blankEstimate?.(wh) != null && html.includes("est-ghost")) {
            moved.add(`${s.label}: ${f.label}`);
            expect(html, where).toContain("推定のもと: ");
            expect(html, where).toContain(source);
            if (rest !== null) expect(sideLines(html), where).toContain(rest);
          }
        }
    // 前は欄の横に推定の出どころを出していた欄（灰色の推定の値を見せる欄）
    expect([...moved].sort()).toEqual(
      [
        "介護・親: 一時費用",
        "介護・親: 月々の費用（自己負担の合計）",
        "介護・親: 期間",
        "働き方と収入: 標準報酬月額（健康保険）",
        "働き方と収入: 標準報酬月額（厚生年金）",
        "子ども・教育: うち部活動など（年額）",
        "子ども・教育: 保育料とは別にかかるお金（年額）",
        "子ども・教育: 入学金",
        "子ども・教育: 受験・併願の費用",
        "子ども・教育: 園の外の費用（習い事など・月額）",
        "子ども・教育: 在学年数",
        "子ども・教育: 学校の費用（年額）",
        "子ども・教育: 学校外の費用（月額）",
        "子ども・教育: 学費（年額）",
        "子ども・教育: 自宅外の仕送り（月額）",
        "子ども・教育: 自宅外の初期費用",
        "貯蓄・運用: 受け取りを始める年齢",
      ].sort(),
    );
  });

  it("FP が値を入れて推定でなくなった欄には、印も出どころも出さない。推定でない使い方の一言は欄の横のまま", () => {
    const wh = fromRequest(modelHousehold("educationTwoKids"), {});
    let n = 0;
    for (const s of STAGE_ORDER)
      for (const f of allFields(buildStage(s.id, wh))) {
        const v = f.get(wh).value === null && fieldStatus(f, wh).status === "estimated" ? (f.blankEstimate?.(wh) ?? null) : null;
        if (v === null) continue;
        const done = typeValue(f, wh, v);
        const html = fieldHtml(done, f);
        expect(fieldStatus(f, done).status, f.label).toBe("confirmed");
        expect(html, f.label).not.toContain("推定のもと");
        expect(html, f.label).not.toContain('data-state="estimated"');
        n++;
      }
    expect(n).toBeGreaterThan(5);
    // 高専・大学などの学校外の費用（統計の平均が無いので推定でない）は、入れ方の一言を欄の横に残す
    const lines = STAGE_ORDER.flatMap((s) => allFields(buildStage(s.id, wh)).flatMap((f) => sideLines(fieldHtml(wh, f))));
    expect(lines).toContain("資格の予備校などがあれば入れます");
  });
});
