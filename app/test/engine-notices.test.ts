// 計算の知らせ（0064）: エンジンの知らせ（コードと ID）を FP 向けの行にする・同じ知らせをまとめる・プランと年と対象を出す・
// 確かめの一覧に入力で直せる知らせを出す・結果のタブの部品
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { PreviewResult } from "../src/engine/types.ts";
import { CalcNotices } from "../src/workspace/CalcNotices.tsx";
import { knownNotice, noticeCounts, noticeMeta, noticeRows, paramName, parseNotice } from "../src/workspace/engineNotices.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const result = (notices: { code: string; ids: string[] }[]): PreviewResult => ({ header: { engine: { version: "x", sourceDigest: "x" }, baseMonth: "2026-10", endYear: 2080, notices }, table: [], summary: null });

describe("知らせを分ける", () => {
  it("部品・話題・物の ID・年に分ける（全体の段の知らせは部品が付かない）", () => {
    const id = "8e88ca7b-8f48-4355-976e-c7cd0fc81138";
    expect(parseNotice({ code: "N_ESTIMATED", ids: ["pension.record", "pensionRecord", id] })).toEqual({ component: "pension.record", topics: ["pensionRecord"], subjects: [id], years: [] });
    expect(parseNotice({ code: "N_PARAM_EXTENDED", ids: ["socialInsurance.care.firstInsured.baseMonthly@1", "2027", "2050"] })).toEqual({ component: null, topics: ["socialInsurance.care.firstInsured.baseMonthly@1"], subjects: [], years: [2027, 2050] });
    expect(parseNotice({ code: "N_PARAM_MISSING", ids: ["education.nurseryFee", "education.nurseryFee.table", "2031-04"] }).years).toEqual([2031]);
    expect(parseNotice({ code: "N_ASSUMED", ids: ["account.contributions.afterRetirement", id] }).component).toBeNull();
  });

  it("制度の値の名前は登録簿の名前（後ろの括弧の注と版を省く）", () => {
    expect(paramName("socialInsurance.care.firstInsured.baseMonthly@1")).toBe("介護保険の第1号被保険者の保険料の基準額");
    expect(paramName("no.such.param")).toBe("制度の値");
  });
});

describe("見本の世帯の知らせ", () => {
  const ids = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));

  it("見本の世帯に出る知らせは、すべて文の表の文で出る（決まりの文に落ちない）", () => {
    const unknown = new Set<string>();
    for (const id of ids) for (const n of preview(modelHousehold(id)).header.notices ?? []) if (!knownNotice(n)) unknown.add(`${n.code} ${n.ids.slice(0, 2).join(",")}`);
    expect([...unknown]).toEqual([]);
  });

  it("文に物の ID・値の ID・コードを出さない", () => {
    for (const id of ["salariedCoupleTwoKids", "sampleSingleParent", "parentCare", "survivorEmployeeLoan"]) {
      const req = modelHousehold(id);
      for (const r of noticeRows(fromRequest(req), [{ label: "プランA", result: preview(req) }])) {
        const all = [r.text, ...noticeMeta(r)].join(" ");
        expect(all).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|N_[A-Z]|[a-z]+\.[a-z]+[A-Z]/);
      }
    }
  });

  it("子の年金の加入記録の推計・受給資格の知らせは出さない（大人の分は出す）", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const rows = noticeRows(fromRequest(req), [{ label: "プランA", result: preview(req) }]);
    expect(rows.some((r) => r.text.includes("受給資格期間"))).toBe(false);
    const rec = rows.find((r) => r.text.includes("年金の加入記録"));
    expect(rec?.subjects.some((s) => s.startsWith("長"))).not.toBe(true);
  });

  it("専門学校の学費が入っていない子は、入力が足りない知らせとして教育のカードへ", () => {
    const req = modelHousehold("sampleSingleParent");
    const rows = noticeRows(fromRequest(req), [{ label: "プランA", result: preview(req) }]);
    const r = rows.find((x) => x.kind === "input");
    expect(r?.card).toBe("education");
    expect(r?.subjects).toEqual(["長男の教育"]);
    expect(rows[0]?.kind).toBe("input");
  });
});

describe("まとめる", () => {
  const req = modelHousehold("parentCare");
  const wh = fromRequest(req);
  const care = req.input.household.careExpenses?.[0]?.id as string;

  it("同じ文の知らせは1行。内訳をまとめ、年の範囲を広げる", () => {
    const rows = noticeRows(wh, [
      {
        label: "プランA",
        result: result([
          { code: "N_DEFAULT_USED", ids: ["care.expense", care, "care.initial"] },
          { code: "N_DEFAULT_USED", ids: ["care.expense", care, "care.months"] },
          { code: "N_PARAM_EXTENDED", ids: ["socialInsurance.care.firstInsured.baseMonthly@1", "2027", "2040"] },
          { code: "N_PARAM_PROJECTED", ids: ["pension.revision", "pension.revisionRate@3", "2027", "2031"] },
          { code: "N_PARAM_EXTENDED", ids: ["socialInsurance.care.firstInsured.baseMonthly@1", "2045", "2050"] },
        ]),
      },
    ]);
    expect(rows).toHaveLength(2);
    const c = rows.find((r) => r.card === "care");
    expect(c?.parts).toEqual(["始めにかかる費用", "介護の期間"]);
    expect(c?.subjects).toHaveLength(1);
    expect(c?.subjects[0]).toMatch(/の介護$/);
    const f = rows.find((r) => r.kind === "data");
    expect(f?.parts).toEqual(["介護保険の第1号被保険者の保険料の基準額（2027〜2050年）", "年金額の改定率（2027〜2031年）"]);
  });

  it("一部のプランだけに出た知らせは、そのプランの名前を出す（全部のプランに出たものは出さない）", () => {
    const a = result([{ code: "N_NOT_SUPPORTED", ids: ["income.flows", "transfers"] }, { code: "N_NOT_DEDUCTIBLE", ids: ["expense.advisoryFee", "advisoryFee"] }]);
    const b = result([{ code: "N_NOT_SUPPORTED", ids: ["income.flows", "transfers"] }]);
    const rows = noticeRows(wh, [
      { label: "プランA", result: b },
      { label: "プランB", result: a },
      { label: "プランC", result: null },
    ]);
    expect(rows.find((r) => r.text.includes("移し替え"))?.plans).toBeNull();
    const fee = rows.find((r) => r.text.includes("FP顧問料"));
    expect(fee?.plans).toEqual(["プランB"]);
    expect(noticeMeta(fee!)).toEqual(["プランBだけ"]);
  });

  it("文の表に無い知らせも、種類の決まりの文で出す（捨てない）", () => {
    const rows = noticeRows(wh, [{ label: "プランA", result: result([{ code: "N_NOT_SUPPORTED", ids: ["some.component", "some.newTopic"] }, { code: "N_SOMETHING_NEW", ids: ["x.y", "z"] }]) }]);
    expect(rows.map((r) => r.kind)).toEqual(["missing", "data"]);
    expect(noticeCounts(rows)).toEqual({ input: 0, missing: 1, outside: 0, assumed: 0, data: 1 });
  });
});

describe("確かめの一覧と結果のタブ", () => {
  it("入力で直せる知らせだけを、確かめの一覧の「計算の知らせ」に出す（開くだけ）", () => {
    const req = modelHousehold("sampleSingleParent");
    const wh = fromRequest(req);
    const notices = noticeRows(wh, [{ label: "プランA", result: preview(req) }]);
    const rows = checkList(wh, notices).filter((r) => r.kind === "calc");
    expect(rows.length).toBe(notices.filter((n) => n.card !== null).length);
    expect(rows.every((r) => r.actions.length === 0 && r.fieldKey === null)).toBe(true);
    expect(rows.find((r) => r.card === "education")?.label).toContain("専門学校");
    // 知らせを渡さなければ前と同じ
    expect(checkList(wh).some((r) => r.kind === "calc")).toBe(false);
  });

  it("結果のタブ: 閉じているときは種類ごとの数の1行。開くと種類ごとの行と「入力で開く」", () => {
    const req = modelHousehold("sampleSingleParent");
    const rows = noticeRows(fromRequest(req), [{ label: "プランA", result: preview(req) }]);
    const closed = renderToString(h(CalcNotices, { rows }));
    expect(closed).toContain("入力が足りない 1");
    expect(closed).not.toContain("data-cn-row");
    const open = renderToString(h(CalcNotices, { rows, initialOpen: true, onOpenCard: () => undefined }));
    expect(open).toContain('data-cn-open="education"');
    expect(open).toContain("入力が足りないため、計算できていない所（1）");
    expect(renderToString(h(CalcNotices, { rows: [] }))).toBe("");
  });

  it("エンジンの知らせの話題（文字で書いたもの）は、すべて文の表にある", () => {
    // エンジンの部品のソース（生成物でない）から、ctx.notice の話題を拾う
    const dir = join(REPO_DIR, "engine", "src", "components");
    const missing: string[] = [];
    for (const comp of readdirSync(dir)) {
      let src: string;
      try {
        src = readFileSync(join(dir, comp, "index.ts"), "utf8");
      } catch {
        continue;
      }
      for (const m of src.matchAll(/\.notice\("(N_[A-Z_]+)",\s*\[([^\]]*)\]/g)) {
        const topic = /"([^"]+)"/.exec(m[2] as string)?.[1];
        if (topic === undefined) continue;
        if (!knownNotice({ code: m[1] as string, ids: [comp, topic] })) missing.push(`${m[1]} ${comp} ${topic}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
