// 「この書類を読む」の入口（0154 の3）: 書類のお願いの1通・書類待ちの欄・保険と年金の見出しから、その書類の読み取りへ進む。
// 入口の初めの値（名義の人・書類の物）を読んだ記録に入れる・画面に入口が出る（プランの編集中は出ない）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { DocRequests } from "../src/workspace/input/DocRequests.tsx";
import { docRequests } from "../src/workspace/input/docRequests.ts";
import { DocReadContext, StateMark } from "../src/workspace/input/FieldViews.tsx";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { allFields } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, availableOps } from "../src/workspace/input/valueState.ts";
import { roles } from "../src/workspace/roles.ts";
import { DocumentStart } from "../src/workspace/documents/DocumentStart.tsx";
import { PasteAnswer } from "../src/workspace/documents/PasteAnswer.tsx";
import { GUIDE_DOC_TYPES, guideText } from "../src/workspace/documents/guides.ts";
import { readProposal } from "../src/workspace/documents/proposal.ts";
import { docReview } from "../src/workspace/documents/review.ts";
import { docStartOf, STAGE_STARTS, withStart } from "../src/workspace/documents/start.ts";
import { PROPOSAL_CONTRACT } from "../src/workspace/documents/types.ts";
import { modelHousehold } from "./helpers.ts";

const AT = "2026-11-07T10:00:00+09:00";
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const noop = () => undefined;
const open = (id = "salariedCoupleTwoKids"): WorkingHousehold => fromRequest(modelHousehold(id));
const members = (wh: WorkingHousehold) => roles(wh.request).map((r) => ({ key: r.key, id: r.member.id }));
const idOf = (wh: WorkingHousehold, key: string) => roles(wh.request).find((r) => r.key === key)!.member.id;

/** 書類で確かめる欄を全部「書類で確かめる」にする */
function allToDocs(wh0: WorkingHousehold): WorkingHousehold {
  let wh = wh0;
  for (let pass = 0; pass < 3; pass++)
    for (const st of buildStages(wh)) for (const f of allFields(st)) if (f.docCheck !== undefined && availableOps(f, wh).includes("unknown")) wh = applyStateOp(wh, f, "unknown");
  return wh;
}

describe("入口の初めの値", () => {
  it("書類のお願いの1通から、書類の種類・電子データで読める書類・名義の人・書類の物を決める", () => {
    const wh = allToDocs(open());
    const reqs = docRequests(wh);
    const self = idOf(wh, "self");
    const loan = (wh.request.input.household.debts ?? []).find((d) => d.kind === "mortgage")!;
    const pension = docStartOf(reqs.find((r) => r.title === "ねんきん定期便（配偶者）")!);
    expect(pension).toEqual({ title: "ねんきん定期便（配偶者）", docType: "pensionStatement", xml: null, holder: idOf(wh, "spouse"), object: null });
    expect(docStartOf(reqs.find((r) => r.title === "住民税の決定通知書（ご本人）")!)).toMatchObject({ docType: "residentTaxNotice", holder: self, object: null });
    const l = docStartOf(reqs.find((r) => r.doc === "住宅ローンの返済予定表")!);
    expect(l).toMatchObject({ docType: "loanSchedule", holder: self, object: loan.id });
    expect(l.xml).toContain("年末残高等証明書");
    expect(docStartOf(reqs.find((r) => r.doc === "会社の退職金規程・制度の資料")!).docType).toBe("other");
  });

  it("読んだ記録に、名義の人（決まっていなければ）と、物を書かない候補の書類の物を入れる。新しい物の候補と、ほかの集まりの候補は変えない", () => {
    const wh = open();
    const loan = (wh.request.input.household.debts ?? [])[0]!.id;
    const spouse = idOf(wh, "spouse");
    const raw = {
      contract: PROPOSAL_CONTRACT,
      docType: "loanSchedule",
      objects: [{ key: "l1", kind: "debt:mortgage" }],
      values: [
        { item: "debt.balance", value: 27612000, period: "once" },
        { item: "debt.principal", newObject: "l1", value: 35000000, period: "once" },
        { item: "pensionRecord.months", at: ["basic"], member: "holder", value: 300 },
      ],
    };
    const r = readProposal(raw, { via: "paste", at: AT, newId, members: members(wh) }).reading!;
    const s = withStart(wh, r, { holder: spouse, object: loan });
    expect(s.holder).toBe(spouse);
    expect(s.candidates.map((c) => c.target.object ?? null)).toEqual([loan, null, null]);
    // 名義の人を選んでいた記録は変えない・世帯に無い人は入れない・入口が無ければそのまま
    expect(withStart(wh, { ...r, holder: idOf(wh, "self") }, { holder: spouse, object: null }).holder).toBe(idOf(wh, "self"));
    expect(withStart(wh, r, { holder: "00000000-0000-4000-8000-999999999999", object: null }).holder).toBeUndefined();
    expect(withStart(wh, r, null)).toBe(r);
    // 物を当てた候補は、そのローンの欄に当たる（FP が当てるローンを選ばなくてよい）
    const row = docReview(wh, s).groups.flatMap((g) => g.rows).find((x) => x.id === s.candidates[0]!.id)!;
    expect(row.problem).toBeNull();
  });
});

describe("画面の入口", () => {
  it("書類のお願いの1通ごとに「この書類を読む」（読み取りの入口があるときだけ）", () => {
    const wh = allToDocs(open());
    expect(renderToString(h(DocRequests, { wh, onOpen: noop }))).not.toContain("data-dr-read");
    const html = renderToString(h(DocRequests, { wh, onOpen: noop, onRead: noop }));
    expect(html.split("data-dr-read=").length - 1).toBe(docRequests(wh).length);
    expect(html).toContain("この書類を読む");
  });

  it("書類待ちの印の中に「この書類を読む」（入力のパネルが入口を置いたときだけ）", () => {
    const mark = (ctx: ((k: string) => void) | null) => renderToString(h(DocReadContext.Provider, { value: ctx }, h(StateMark, { status: "unknown", basis: "推定", text: "書類待ち", label: "加入月数", fieldKey: "f1", doc: "ねんきん定期便" })));
    expect(mark(null)).not.toContain("data-state-read-doc");
    expect(mark(noop)).toContain('data-state-read-doc="f1"');
    const est = renderToString(h(DocReadContext.Provider, { value: noop }, h(StateMark, { status: "estimated", basis: "推定", text: "推定", label: "加入月数", fieldKey: "f1" })));
    expect(est).not.toContain("data-state-read-doc");
  });

  it("保険・年金の入力項目の見出しに「書類から読む」の1行。ほかの入力項目・入口の無いときは出ない", () => {
    const wh = allToDocs(open());
    const panel = (itemId: string, onReadDoc?: () => void, level: "simple" | "detail" = "simple") => renderToString(h(InputPanel, { wh, itemId, level, onLevel: noop, onSave: noop, onClose: noop, ...(onReadDoc !== undefined ? { onReadDoc } : {}) }));
    for (const id of ["insurance", "pension"]) {
      const html = panel(id, noop);
      expect(html, id).toContain(`data-panel-read-doc="${id}"`);
      expect(html).toContain(STAGE_STARTS[id]!.line);
      expect(panel(id), id).not.toContain("data-panel-read-doc");
    }
    expect(panel("living", noop)).not.toContain("data-panel-read-doc");
    // 年金の書類待ちの欄（詳細の加入月数）の印に「この書類を読む」。入口の無いときは出ない
    expect(panel("pension", noop, "detail")).toContain("data-state-read-doc");
    expect(panel("pension", undefined, "detail")).not.toContain("data-state-read-doc");
  });

  it("「この書類を読む」の画面: 電子データで読める書類なら XML の入口、AI の答えの貼り付け、名義の人の初めの値を出す", () => {
    const wh = allToDocs(open());
    const loan = docStartOf(docRequests(wh).find((r) => r.doc === "住宅ローンの返済予定表")!);
    const html = renderToString(h(DocumentStart, { wh, start: loan, onReadings: noop, onPaste: noop, onClose: noop }));
    expect(html).toContain("この書類を読む: 住宅ローンの返済予定表（ご本人）");
    expect(html).toContain("data-documents-start-xml");
    expect(html).toContain("data-documents-start-paste-open");
    expect(html).toContain("「ご本人」にしておきます");
    expect(html).not.toContain("data-documents-start-ai");
    const pension = docStartOf(docRequests(wh).find((r) => r.title === "ねんきん定期便（ご本人）")!);
    expect(renderToString(h(DocumentStart, { wh, start: pension, onReadings: noop, onPaste: noop, onAiShare: noop, onClose: noop }))).toMatch(/data-documents-start-ai[^-]/u);
    expect(renderToString(h(DocumentStart, { wh, start: pension, onReadings: noop, onPaste: noop, onClose: noop }))).not.toContain("data-documents-start-xml");
  });

  it("貼り付けの画面は、入口の書類の種類の読み方の手引きを選んだ形で開く", () => {
    const wh = open("sampleSingle40s");
    const html = renderToString(h(PasteAnswer, { wh, gate: { ok: true, sample: true }, guide: { options: GUIDE_DOC_TYPES, text: guideText }, initialGuide: "loanSchedule", onRead: noop, onClose: noop }));
    expect(html).toMatch(/<option selected value="loanSchedule"/u);
  });
});

describe("読み方の手引き", () => {
  it("公的年金等の源泉徴収票と住宅借入金等特別控除証明書は手引きを写せる", () => {
    expect(guideText("publicPensionWithholding")).toContain("公的年金等の源泉徴収票の読み方");
    expect(guideText("housingLoanCredit")).toContain("年末調整のための住宅借入金等特別控除証明書（税務署）");
  });
});
