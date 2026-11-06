// 推定と未入力の数え方・確かめの一覧・ホームの札（0041 の追記 2026-11-06）:
// 仮の値は推定と分けて未入力の側に・前提条件の標準の値は推定の数とまとめての操作から外す・数は「か所」「件」・推定の操作の言葉・
// 推定の根拠の頭「既定の値」・入っていない物の中身の1行・欄の外の年月・ホームの札の要約と状態
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { PreviewResult } from "../src/engine/types.ts";
import { noticeRows } from "../src/workspace/engineNotices.ts";
import { checkButtonText, checkSummary } from "../src/workspace/input/CheckList.tsx";
import { checkCounts, checkList, confirmAllEstimates, estimatedFields, structuresInUse, yearMonthText } from "../src/workspace/input/checkRows.ts";
import { gapsOf } from "../src/workspace/input/fill.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, presetBasis, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputView } from "../src/workspace/input/InputView.tsx";
import { estimatedList, inputItems, itemOf, itemStage, pinItems, progressOf, togglePin } from "../src/workspace/input/items.ts";
import { inheritanceTaxNote } from "../src/workspace/input/inheritanceLine.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { addOutside } from "../src/workspace/input/stages/care.ts";
import { newOtherLoan } from "../src/workspace/input/stages/housingLoans.ts";
import { putRow, rowAt } from "../src/workspace/input/rows.ts";
import type { Debt } from "../src/engine/types.ts";
import { statusText } from "../src/workspace/input/StatusBadge.tsx";
import { applyStateOp, availableOps, endedLongAgo, fieldStatus, holderOfField } from "../src/workspace/input/valueState.ts";
import { modelHousehold } from "./helpers.ts";

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const fieldOf = (wh: WorkingHousehold, card: string, key: string | RegExp): FieldDef => {
  const st = itemStage(wh, card);
  const f = st === null ? undefined : allFields(st).find((x) => (typeof key === "string" ? x.key === key : key.test(x.key)));
  if (f === undefined) throw new Error(`欄が無い: ${String(key)}`);
  return f;
};
/** 画面に出る数の言い方に「○つ」が無い（10以上でも「つ」を使っていた） */
const NO_TSU = /\d+つ[）」・、。 ]|\d+つ$/;

describe("仮の値（生年月など）は推定と分ける", () => {
  it("新しい顧客の生年月は「仮の値（40歳として計算中）。生年月を入れてください」で、「この値にする」を出さない", () => {
    const wh = blankHousehold("2026-11", seq());
    const birth = fieldOf(wh, "family", /\/birth$/);
    const s = fieldStatus(birth, wh);
    expect(s.status).toBe("estimated");
    expect(s.provisional).toBe(true);
    expect(s.basis).toBe("仮の値（40歳として計算中）。生年月を入れてください");
    expect(availableOps(birth, wh, s)).not.toContain("confirm");
    expect(applyStateOp(wh, birth, "confirm")).toBe(wh);
  });

  it("「＋ 配偶者」「＋ 子」の仮の生年月も、まとめての「この値にする」で確定にならない（確かめの一覧では未入力の側）", () => {
    const ids = seq();
    let wh = blankHousehold("2026-11", ids);
    wh = addMember(wh, "spouse", ids);
    wh = addMember(wh, "child", ids);
    const births = allFields(itemStage(wh, "family") ?? { id: "family", label: "", lead: "", sections: [] }).filter((f) => f.key.endsWith("/birth"));
    expect(births).toHaveLength(3);
    for (const f of births) expect(fieldStatus(f, wh).provisional).toBe(true);
    expect(estimatedFields(wh).some((f) => f.key.endsWith("/birth"))).toBe(false);
    const after = confirmAllEstimates(wh).wh;
    for (const f of births) expect(fieldStatus(f, after).provisional).toBe(true);
    const rows = checkList(wh).filter((r) => r.fieldKey?.endsWith("/birth") === true);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.kind).toBe("missing");
      expect(r.detail).toMatch(/^仮の値（\d+歳として計算中）。生年月を入れてください$/);
      expect(r.actions).toEqual([]);
    }
  });

  it("生まれる予定の子の推定（今から2年後）は仮の値ではない（推定のまま）", () => {
    const ids = seq();
    const wh = addMember(blankHousehold("2026-11", ids), "child", ids, { expected: true });
    const f = allFields(itemStage(wh, "family") ?? { id: "family", label: "", lead: "", sections: [] }).filter((x) => x.key.endsWith("/birth")).at(-1) as FieldDef;
    expect(fieldStatus(f, wh).provisional).toBeUndefined();
  });
});

describe("前提条件の標準の値は推定の数とまとめての操作から外す", () => {
  it("見本 3-4-01: 推定の行に前提条件が無く、いちばん下の「前提条件の標準の値」にまとめる。耐用年数は木造の家だけ", () => {
    const wh = open("salariedCoupleTwoKids");
    const rows = checkList(wh);
    expect(rows.filter((r) => r.kind === "estimated" && r.card === "assumptions")).toEqual([]);
    const premise = rows.filter((r) => r.kind === "premise");
    expect(premise.length).toBeGreaterThan(5);
    expect(premise.every((r) => r.card === "assumptions")).toBe(true);
    expect(premise.map((r) => r.fieldKey).filter((k) => k?.startsWith("assume/realEstate/life/"))).toEqual(["assume/realEstate/life/wood"]);
    expect(rows.at(-1)?.kind).toBe("premise");
    // 入口の数に前提条件を数えない・まとめての「この値にする」で前提条件を確定にしない
    const sum = checkSummary(wh);
    expect(sum.total).toBe(rows.filter((r) => r.kind !== "premise" && r.kind !== "certainty").length);
    expect(estimatedFields(wh).some((f) => f.key.startsWith("assume/"))).toBe(false);
    const after = confirmAllEstimates(wh).wh;
    expect(fieldStatus(fieldOf(after, "assumptions", "assume/inflation"), after).status).toBe("estimated");
  });

  it("世帯の建物の構造: 持ち家（マンションは鉄筋コンクリート造・ほかは木造）と物件", () => {
    expect([...structuresInUse(open("salariedCoupleTwoKids").request.input.household)]).toEqual(["wood"]);
    expect(structuresInUse(blankHousehold("2026-11", seq()).request.input.household).size).toBe(0);
  });

  it("前提条件の札: 既定の値のままなら「既定の値で計算中」、打つか「この値にする」で「入力済み」。要約は物価と運用利回り", () => {
    const wh = blankHousehold("2026-11", seq());
    const a = itemOf(wh, "assumptions");
    expect(a?.status).toBe("std");
    expect(statusText(a ?? { status: "std", estimated: 0 })).toBe("既定の値で計算中");
    expect(a?.summary).toEqual({ pre: "物価 ", main: "1.0", unit: "%・運用 1.0%" });
    expect(progressOf(inputItems(wh)).std).toBe(1);
    const inf = fieldOf(wh, "assumptions", "assume/inflation");
    expect(itemOf(inf.set(wh, "0.02"), "assumptions")?.status).toBe("done");
    expect(itemOf(applyStateOp(wh, inf, "confirm"), "assumptions")?.status).toBe("done");
  });

  it("FP顧問料の契約があれば、前提条件の要約の下に1行（提案の側）", () => {
    const wh = open("advisoryFeeProposal");
    const note = itemOf(wh, "assumptions")?.summary?.note;
    expect(note).toMatch(/^FP顧問料: /);
    expect(note).toContain("（提案の側）");
  });
});

describe("数え方（「か所」「件」）と操作の言葉", () => {
  it("パネルの札・保存の下の行は同じ数を「か所」で。ボタンは「推定のままの値を「この値にする」」（見えている欄だけなら「見えている」）", () => {
    const wh = blankHousehold("2026-11", seq());
    const living = itemOf(wh, "living");
    expect(living?.status).toBe("est");
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", initialOpen: "living" }));
    expect(html).toContain(`推定で計算中（${living?.estimated ?? 0}か所）`);
    expect(html).toContain(`推定・仮の値のままの欄: ${living?.estimated ?? 0}か所`);
    expect(html).toMatch(/推定のままの値を「この値にする」（見えている \d+か所）/);
    expect(html).not.toMatch(NO_TSU);
    expect(html).not.toContain("推定の値をまとめて使う");
  });

  it("確かめの一覧のボタンは「未入力 ○か所・推定 ○か所 ほか」、開いた中の数は単位つき。入っていない物は「推定で入れる」", () => {
    const wh = blankHousehold("2026-11", seq());
    const counts = checkCounts(checkList(wh));
    expect(checkButtonText(counts)).toBe(`確かめの一覧（未入力 ${counts.missing}か所・推定 ${counts.estimated}か所 ほか）`);
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", initialOpen: "check" }));
    expect(html).toContain(`未入力 ${counts.missing}か所`);
    expect(html).toContain(`推定（${counts.estimated}か所）`);
    expect(html).toContain("推定のままの値を「この値にする」（全部");
    expect(html).not.toContain("推定で埋める");
    expect(html).not.toContain("推定の値をまとめて使う");
    expect(html).not.toMatch(NO_TSU);
  });

  it("ホームの未入力は、0なら灰色の文字だけ（赤い札を出さない）。数は入力項目の数", () => {
    const wh = open("salariedCoupleTwoKids");
    const zero = mutate(blankHousehold("2026-11", seq()), () => undefined);
    const p = progressOf(inputItems(zero));
    expect(p.missing).toBe(0);
    const html = renderToString(h(InputView, { wh: zero, onSave: () => undefined, level: "simple" }));
    expect(html).toMatch(/class="ih-prog-miss zero"[^>]*>.*?<span class="ih-prog-zero">未入力<\/span> <span class="n">0<\/span>/s);
    const red = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple" }));
    expect(red).toContain('<span class="ih-st missing mini">未入力（0円の所あり）</span>');
  });
});

describe("推定の根拠の頭は「既定の値」（前の「目安のボタンの値」も読む）", () => {
  it("新しく入れる既定の値の根拠", () => {
    expect(presetBasis("家賃 月8万円")).toBe("既定の値（家賃 月8万円。この世帯に合わせて直してください）");
  });

  it("ほかのローンの種類を変えると、前の文（目安のボタンの値）のままの金利も新しい種類の目安に入れ直す", () => {
    const wh0 = newOtherLoan(blankHousehold("2026-11", seq()), "cardLoan");
    const d = (wh0.request.input.household.debts ?? []).at(-1) as Debt;
    const a = { target: { object: d.id }, item: "debt.rateSchedule", at: [d.rateSchedule[0]?.id as string, "rate"] };
    const wh = mutate(wh0, (_h, req) => void putRow(req.input as unknown as Record<string, unknown>, a, { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "目安のボタンの値（カードローン・リボ 年15%。わかれば直してください）" } }));
    const sub = fieldOf(wh, "housing", new RegExp(`${d.id}.*/subtype$`));
    const next = sub.set(wh, "scholarship");
    const nd = (next.request.input.household.debts ?? []).find((x) => x.id === d.id) as Debt;
    expect(nd.rateSchedule[0]?.rate).not.toBe(d.rateSchedule[0]?.rate);
    expect(rowAt(next.request.input as unknown as Record<string, unknown>, a)?.estimate?.basis).toMatch(/^既定の値（/);
  });
});

describe("入っていない物の「推定で入れる」で入る中身", () => {
  it("住まいの無い世帯: 「賃貸・家賃 月8万円（よくある額）」と、持ち家ならの案内。確かめの一覧の行にも出す", () => {
    const wh = blankHousehold("2026-11", seq());
    const g = gapsOf(wh).find((x) => x.id === "housing");
    expect(g?.what).toBe("賃貸・家賃 月8万円（よくある額）");
    expect(g?.alt).toContain("持ち家なら");
    const row = checkList(wh).find((r) => r.id === "gap:housing");
    expect(row?.detail).toContain("推定で入れる中身: 賃貸・家賃 月8万円（よくある額）");
    expect(row?.actions.map((a) => a.label)).toEqual(["推定で入れる", "該当なし（住居費なし）"]);
  });

  it("パネルの帯は本文の頭に1件1行で（パネルの上の固定の場所に置かない）", () => {
    const wh = mutate(blankHousehold("2026-11", seq()), () => undefined);
    const started = { ...wh, confirmed: [] };
    const html = renderToString(h(InputView, { wh: started, onSave: () => undefined, level: "simple", initialOpen: "housing" }));
    const body = html.indexOf('class="ip-body"');
    const gaps = html.indexOf("data-gaps=");
    expect(gaps).toBeGreaterThan(body);
    expect(html).toContain("推定で入れる中身: 賃貸・家賃 月8万円（よくある額）");
  });
});

describe("確かめの一覧の年月と、出さない推定", () => {
  it("欄の外の年月は「2030年4月」の形", () => {
    expect(yearMonthText("亡くなる見込み 2030-04")).toBe("亡くなる見込み 2030年4月");
    expect(yearMonthText("2027-11〜2031-09")).toBe("2027年11月〜2031年9月");
    expect(yearMonthText("年 2027〜2050年")).toBe("年 2027〜2050年");
  });

  it("世帯の外の親の亡くなる見込みは「2041年4月（父85歳）」のように人の年齢を添える", () => {
    const wh = addOutside(blankHousehold("2026-11", seq()), "parent", { sex: "male" });
    const row = checkList(wh).find((r) => r.label.endsWith("亡くなる見込み"));
    expect(row?.value).toMatch(/^\d{4}年\d{1,2}月（父\d+歳）$/);
    expect(checkList(wh).some((r) => r.value != null && /\d{4}-\d{2}/.test(r.value))).toBe(false);
  });

  it("ずっと前に終わった働き方の期間の推定は、確かめの一覧にも入力項目の推定の数にも入れない", () => {
    const wh0 = blankHousehold("2026-11", seq());
    const self = wh0.request.input.household.members[0]?.id as string;
    const wh = mutate(wh0, (hh) => {
      hh.employmentPeriods = [{ id: "00000000-0000-4000-8000-0000000000aa", member: self, type: "regular", from: { at: "2008-04" }, to: { at: "2015-03" }, salary: { annual: { value: 3000000, state: "confirmed", origin: { kind: "manual" } } }, endsWith: "voluntary" } as never];
    });
    expect(endedLongAgo(wh, "00000000-0000-4000-8000-0000000000aa")).toBe(true);
    for (const r of checkList(wh)) expect(r.holder === "00000000-0000-4000-8000-0000000000aa" && (r.kind === "estimated" || r.kind === "unknown")).toBe(false);
    const st = itemStage(wh, "work");
    for (const f of st === null ? [] : allFields(st)) if (holderOfField(f, wh) === "00000000-0000-4000-8000-0000000000aa") expect(estimatedFields(wh)).not.toContain(f);
  });
});

describe("計算のお知らせ: 定期便の推計の対象に世帯の外の家族を入れない", () => {
  it("世帯の外の親は対象に出さない（ご本人は出す）", () => {
    const wh = open("parentCare");
    const h0 = wh.request.input.household;
    const self = h0.members.find((m) => m.kind === "self")?.id as string;
    const parent = h0.members.find((m) => m.outside !== undefined)?.id as string;
    const r: PreviewResult = { header: { engine: { version: "x", sourceDigest: "x" }, baseMonth: "2026-10", endYear: 2080, notices: [{ code: "N_ESTIMATED", ids: ["pension.record", "pensionRecord", self] }, { code: "N_ESTIMATED", ids: ["pension.record", "pensionRecord", parent] }] }, table: [], summary: null };
    const rows = noticeRows(wh, [{ label: "現状", result: r }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjects).toEqual(["ご本人"]);
    const onlyParent = noticeRows(wh, [{ label: "現状", result: { ...r, header: { ...r.header, notices: [{ code: "N_ESTIMATED", ids: ["pension.record", "pensionRecord", parent] }] } } }]);
    expect(onlyParent).toEqual([]);
  });
});

describe("ホームの札の要約と1行", () => {
  it("子ども・教育: 私立になる最初の段（「2人・大学は私立」）", () => {
    const wh = open("salariedCoupleTwoKids");
    expect(itemOf(wh, "education")?.summary?.unit).toMatch(/^人・(.+は私立|.+から私立( \d人)?|公立)$/);
    expect(itemOf(wh, "education")?.summary?.unit).not.toContain("私立あり");
  });

  it("働き方と収入: 自営業は「事業所得 ○万円」", () => {
    const wh = open("selfEmployed");
    expect(itemOf(wh, "work")?.summary?.pre).toBe("事業所得 ");
  });

  it("介護・親: 介護の費用の総額か月の額と、介護を受ける人・親の人数", () => {
    const wh = open("parentCare");
    const s = itemOf(wh, "care")?.summary;
    expect(`${s?.pre ?? ""}${s?.main ?? ""}${s?.unit ?? ""}`).toMatch(/^介護 (約|月)[\d,.]+万円（.+）・親 1人$/);
  });

  it("ピン: 名前は「○○の介護」、要約は「月○万円・○か月」、ボタンは「ピンを外す」", () => {
    const wh0 = open("parentCare");
    const c = (wh0.request.input.household.careExpenses ?? []).find((x) => x.months !== undefined);
    expect(c).toBeDefined();
    const wh = togglePin(wh0, { kind: "care", ref: c?.id as string, art: "events" }, seq());
    const pin = pinItems(wh)[0];
    expect(pin?.label).toMatch(/の介護$/);
    expect(`${pin?.summary?.pre ?? ""}${pin?.summary?.main ?? ""}${pin?.summary?.unit ?? ""}`).toMatch(/^月[\d.]+万円・\d+か月$/);
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple" }));
    expect(html).toContain("ピンを外す");
  });

  it("推定で計算中の札は、カーソル・フォーカス・押すと何が推定かの短い一覧を出す（札の下に1行は足さない。札の文字は同じ）", () => {
    expect(estimatedList(["基本生活費（月額）", "退職後の生活費（今の額に対する割合）"], 2)).toEqual({ names: ["基本生活費", "退職後の生活費"], rest: 0 });
    expect(estimatedList(["a", "b", "c", "d", "e", "f"], 9)).toEqual({ names: ["a", "b", "c", "d", "e"], rest: 4 });
    expect(estimatedList([], 1)).toBeNull();
    const wh = blankHousehold("2026-11", seq());
    const living = itemOf(wh, "living");
    expect(living?.hint).not.toMatch(/^推定: /);
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple" }));
    const at = html.indexOf('data-est-tip="living"');
    expect(at).toBeGreaterThan(0);
    const part = html.slice(at, html.indexOf("</div>", at));
    expect(part).toContain('class="help-btn help-mark ih-st est mini"');
    expect(part).toContain(">推定で計算中</button>");
    expect(part).toContain("aria-describedby");
    expect(part).toContain("<li>基本生活費</li>");
    // 開くボタンの中に札を重ねて出さない
    const card = html.slice(html.indexOf('data-card="living"'), at);
    expect(card).not.toContain("推定で計算中</span>");
  });

  it("相続税の1行は、どの場面の目安かを書く", () => {
    const r = { inheritanceTax: { points: [{ point: "bothAfter", status: "ok", state: "estimated", noTax: false, payable: 23_300_000, amount: 0 }] } } as unknown as PreviewResult;
    expect(inheritanceTaxNote(r)).toBe("相続税（二人とも亡くなった後）: 約2,330万円");
  });
});
