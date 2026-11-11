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
import { allFields, type FieldDef, type Val } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { careStartShort, careTemplate, careTemplateStart, fillAll } from "../src/workspace/input/fill.ts";
import { salaryEstimate, withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
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

// ---- 推定の印の続き（0041 の追記 2026-11-11）: 介護の始まり・次の段階の始まり、定年後の年収、選ぶ欄の空の選択肢 ----

const actionOf = (wh: WorkingHousehold, stageId: "care" | "work", key: string) => {
  const a = buildStage(stageId, wh)
    .sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])
    .find((x) => x.key === key);
  if (a === undefined) throw new Error(`no action ${key}`);
  return a;
};

describe("介護の始まりの推定の印", () => {
  it("介護の目安の物の始まりは推定（欄の中は灰色の推定の時点・名前の横に「推定」・「この値にする」・欄の横に根拠の短い文）。置き方は前のまま", () => {
    const { wh, id } = withCare();
    const f = careField(wh, id, "from");
    const s = fieldStatus(f, wh);
    expect(s.status).toBe("estimated");
    expect(s.basis).toMatch(/^推定（亡くなる見込みから統計の平均の期間を逆算。介護の期間の統計の平均（\d+か月。/);
    const c = wh.request.input.household.careExpenses![0]!;
    const p = wh.request.input.household.members.find((m) => m.id === c.member)!;
    expect(c.from).toEqual(careTemplateStart(wh.request.input.household, p, BASE).from);
    expect(careTemplate(wh.request.input.household, p, BASE).from).toEqual(c.from);
    const html = fieldHtml(wh, f);
    expect(html).toContain('<div class="fld when is-est"');
    expect(html).toContain(`<span class="fld-hint" data-when-note="ev/care/${id}/from">亡くなる見込みから統計の平均の期間を逆算</span>`);
    expect(html).toContain("この値にする");
    expect(availableOps(f, wh)).toContain("confirm");
  });

  it("「この値にする」・時点を直すと推定の印が外れる（時点は同じ・直した時点）。外すと印も消える", () => {
    const { wh, id } = withCare();
    const f = careField(wh, id, "from");
    const w1 = applyStateOp(wh, f, "confirm");
    expect(w1.assumed[`ev/care/${id}/from`]).toBeUndefined();
    expect(fieldStatus(careField(w1, id, "from"), w1).status).toBe("confirmed");
    expect(w1.request.input.household.careExpenses![0]!.from).toEqual(wh.request.input.household.careExpenses![0]!.from);
    const w2 = f.time!.setWhen(wh, { at: "2040-04" }, "auto");
    expect(w2.assumed[`ev/care/${id}/from`]).toBeUndefined();
    expect(fieldStatus(careField(w2, id, "from"), w2).status).toBe("confirmed");
    expect(fieldHtml(w2, careField(w2, id, "from"))).not.toContain("data-when-note");
    const w3 = actionOf(wh, "care", `ev/care/${id}/remove`).run(wh);
    expect(w3.request.input.household.careExpenses ?? []).toHaveLength(0);
    expect(w3.assumed[`ev/care/${id}/from`]).toBeUndefined();
  });

  it("「＋ 次の段階を足す」で足した段階の始まりも推定（前の段階の終わりの翌月）。「＋ 介護の費用」も同じ", () => {
    const { wh, id } = withCare();
    const w1 = actionOf(wh, "care", `ev/care/${id}/nextStage`).run(wh);
    const next = w1.request.input.household.careExpenses!.find((x) => x.id !== id)!;
    const f = careField(w1, next.id, "from");
    expect(fieldStatus(f, w1)).toMatchObject({ status: "estimated" });
    expect(fieldStatus(f, w1).basis).toBe(`推定（前の段階の終わりの翌月。前の段階の始まりに、その期間（${String(careEstimate("home")!.months)}か月。期間が空なので統計の平均の推定）を足しています）`);
    expect(fieldHtml(w1, f)).toContain(">前の段階の終わりの翌月</span>");
    // 前の段階の期間を入れていれば、その期間（統計の推定とは書かない）
    const w2 = careField(wh, id, "months").set(wh, 24);
    const w3 = actionOf(w2, "care", `ev/care/${id}/nextStage`).run(w2);
    const n3 = w3.request.input.household.careExpenses!.find((x) => x.id !== id)!;
    expect(w3.assumed[`ev/care/${n3.id}/from`]).toBe("推定（前の段階の終わりの翌月。前の段階の始まりに、その期間（24か月）を足しています）");
    // ＋ 介護の費用（親がいれば親の介護）
    const w4 = actionOf(wh, "care", "ev/addCare").run(wh);
    const added = w4.request.input.household.careExpenses!.find((x) => x.id !== id)!;
    expect(w4.assumed[`ev/care/${added.id}/from`]).toMatch(/^推定（/);
  });

  it("根拠の短い文は「推定（短い文。…）」の形の根拠だけ（ヒアリングシートの仮の値などは出さない）", () => {
    expect(careStartShort("推定（亡くなる見込みが無いため1年後。介護を受ける人の…）")).toBe("亡くなる見込みが無いため1年後");
    expect(careStartShort("仮の値（介護が始まっている。始まった年月はシートでお聞きしていません）")).toBeNull();
    expect(careStartShort(undefined)).toBeNull();
  });
});

describe("選ぶ欄の空の選択肢（iDeCo・企業型DC の受け取り方）", () => {
  it("空欄は「（推定: 一時金）」（エンジンは受け取り方が空なら一時金で計算する）", () => {
    const src = readFileSync(join(REPO_DIR, "engine", "src", "components", "account.idecoPayout", "index.ts"), "utf8");
    expect(src).toContain('const method = a.payout?.method ?? "lumpSum";');
    let found = 0;
    for (const m of ["dualAssetsTwoKids", "investmentCouple", "single45", "idecoPayout"]) {
      const wh = fromRequest(modelHousehold(m), {});
      for (const f of allFields(buildStage("savings", wh))) {
        if (!f.key.endsWith("/payout") || f.kind !== "select" || f.get(wh).value !== null) continue;
        found++;
        const html = fieldHtml(wh, f);
        expect(html).toMatch(/<option selected value>（推定: 一時金）<\/option>/);
        expect(html).not.toContain("（選ぶ）");
        // 選んだ欄は空の選択肢を出さない
        const w1 = f.set(wh, "annuity");
        expect(fieldHtml(w1, allFields(buildStage("savings", w1)).find((x) => x.key === f.key)!)).not.toContain("（推定:");
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("推定の値を持たない選ぶ欄の空の選択肢は「（選ぶ）」のまま", () => {
    let found = 0;
    for (const m of ["dualAssetsTwoKids", "single45"]) {
      const wh = fromRequest(modelHousehold(m), {});
      for (const s of STAGE_ORDER)
        for (const f of allFields(buildStage(s.id, wh))) {
          if (f.kind !== "select" || f.readOnly !== undefined || f.blankEstimate !== undefined || f.time !== undefined || f.get(wh).value !== null) continue;
          found++;
          expect(fieldHtml(wh, f)).not.toContain("（推定:");
        }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe("定年後の年収の推定の印", () => {
  /** 新しい世帯: 本人を会社員として入れる（60歳の定年・65歳まで再雇用の推定が入る） */
  function worker(): { wh: WorkingHousehold; self: string } {
    let wh = blankHousehold(BASE, seq());
    const self = wh.request.input.household.members[0]!.id;
    wh = withRefreshedEstimates(allFields(buildStage("family", wh)).find((x) => x.key === `family/${self}/birth`)!.set(wh, "1980-06"));
    wh = withRefreshedEstimates(actionOf(wh, "work", `work/${self}/start`).run(wh));
    return { wh, self };
  }
  const workField = (wh: WorkingHousehold, key: string) => allFields(buildStage("work", wh)).find((x) => x.key === key)!;
  const edit = (wh: WorkingHousehold, key: string, v: Val) => withRefreshedEstimates(workField(wh, key).set(wh, v));
  const postPeriodOf = (wh: WorkingHousehold, self: string) => (wh.request.input.household.employmentPeriods ?? []).filter((p) => p.member === self).sort((a, b) => (a.from.at ?? "").localeCompare(b.from.at ?? ""))[1];

  it("定年後の働き方を選び直すと、年収は前の値のまま（作り方は前のまま）推定の印のまま（前は確定で書いていた）", () => {
    const { wh, self } = worker();
    const before = postPeriodOf(wh, self)!.salary!.annual;
    expect(before.state).toBe("estimated");
    const w1 = edit(wh, `work/${self}/postType`, "partTime");
    const after = postPeriodOf(w1, self)!;
    expect(after.type).toBe("partTime");
    expect(after.salary!.annual).toMatchObject({ value: before.value, state: "estimated", origin: { kind: "auto" } });
    expect(fieldStatus(workField(w1, `work/${self}/postSalary`), w1).status).toBe("estimated");
  });

  it("働かないから選ぶと統計の推定（その働き方・定年の年齢の統計の値。推定の入れ直しでも同じ値）。働く最後を延ばして作った期間でも推定の箱のまま", () => {
    const { wh, self } = worker();
    const w0 = edit(wh, `work/${self}/postType`, "");
    expect(postPeriodOf(w0, self)).toBeUndefined();
    const w1 = edit(w0, `work/${self}/postType`, "contract");
    const want = salaryEstimate("contract", { age: 60 })!.annual;
    expect(w1.postRetirement[self]).toMatchObject({ type: "contract", annualSalary: want.value });
    const f = workField(w1, `work/${self}/postSalary`);
    expect(f.get(w1).value).toBe(want.value);
    expect(fieldStatus(f, w1)).toMatchObject({ status: "estimated", basis: want.basis });
    // 働く最後を延ばすと定年後の期間ができ、年収は統計の推定の箱（推定の入れ直しの後も同じ値）。画面の側の印は外れる
    const w2 = edit(w1, `work/${self}/retireAge`, 65);
    const pp = postPeriodOf(w2, self)!;
    expect(pp.salary!.annual).toMatchObject({ value: want.value, state: "estimated", estimate: { method: "statistic", basis: want.basis } });
    expect(w2.assumed[`work/${self}/postSalary`]).toBeUndefined();
    expect(withRefreshedEstimates(w2).request.input.household.employmentPeriods!.find((p) => p.id === pp.id)!.salary!.annual.value).toBe(want.value);
    // 定年前の年収を直しても、統計の推定は再雇用の割合の推定に置き換えない
    const mainKey = `work/period/${(w2.request.input.household.employmentPeriods ?? []).find((p) => p.member === self && p.type === "regular")!.id}/annual`;
    const w3 = edit(w2, mainKey, 6000000);
    expect(postPeriodOf(w3, self)!.salary!.annual.value).toBe(want.value);
  });

  it("「この値にする」・打った値で確定にすると印が外れる", () => {
    const { wh, self } = worker();
    const w1 = edit(edit(wh, `work/${self}/postType`, ""), `work/${self}/postType`, "contract");
    const f = workField(w1, `work/${self}/postSalary`);
    const w2 = applyStateOp(w1, f, "confirm");
    expect(w2.assumed[`work/${self}/postSalary`]).toBeUndefined();
    expect(fieldStatus(workField(w2, `work/${self}/postSalary`), w2).status).toBe("confirmed");
    const w3 = edit(w1, `work/${self}/postSalary`, 2500000);
    expect(w3.assumed[`work/${self}/postSalary`]).toBeUndefined();
    expect(w3.postRetirement[self]!.annualSalary).toBe(2500000);
  });
});
