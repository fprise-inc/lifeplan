// 「この書類を読む」の入口（0154 の3）: 書類のお願いの1通・書類待ちの欄・保険の見出しから、その書類の読み取りへ進む。
// 入口の初めの値（名義の人・書類の物）を読んだ記録に入れる・画面に入口が出る（プランの編集中は出ない）。
// 読めるのは保険証券・ご契約内容のお知らせ・設計書だけ（0159）なので、入口は保険証券の書類のお願い・書類待ちと、保険の見出しにだけ出る
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
import { createObject } from "../src/workspace/documents/apply.ts";
import { readProposal } from "../src/workspace/documents/proposal.ts";
import { docReview } from "../src/workspace/documents/review.ts";
import { docStartOf, readableDoc, STAGE_STARTS, withStart } from "../src/workspace/documents/start.ts";
import { PROPOSAL_CONTRACT } from "../src/workspace/documents/types.ts";
import { modelHousehold } from "./helpers.ts";

const AT = "2026-11-07T10:00:00+09:00";
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const noop = () => undefined;
const open = (id = "salariedCoupleTwoKids"): WorkingHousehold => fromRequest(modelHousehold(id));
const members = (wh: WorkingHousehold) => roles(wh.request).map((r) => ({ key: r.key, id: r.member.id }));
const idOf = (wh: WorkingHousehold, key: string) => roles(wh.request).find((r) => r.key === key)!.member.id;

/** 医療保険（手術の特約つき）を1件足した世帯 */
const withMedical = (wh: WorkingHousehold): WorkingHousehold => createObject(wh, "insurance:medical")!.wh;

/** 書類で確かめる欄を全部「書類で確かめる」にする */
function allToDocs(wh0: WorkingHousehold): WorkingHousehold {
  let wh = wh0;
  for (let pass = 0; pass < 3; pass++)
    for (const st of buildStages(wh)) for (const f of allFields(st)) if (f.docCheck !== undefined && availableOps(f, wh).includes("unknown")) wh = applyStateOp(wh, f, "unknown");
  return wh;
}

describe("入口の初めの値", () => {
  it("書類のお願いの1通のうち、保険証券だけに読み取りの入口を作る（名義の人・書類の物を初めの値に）。ほかの書類は入口を作らない", () => {
    const wh = allToDocs(withMedical(open()));
    const reqs = docRequests(wh);
    const policy = reqs.find((r) => r.doc === "保険証券")!;
    expect(readableDoc(policy.doc)).toBe(true);
    expect(docStartOf(policy)).toEqual({ title: policy.title, docType: "insurancePolicy", holder: idOf(wh, "self"), object: policy.object });
    for (const doc of ["ねんきん定期便", "住民税の決定通知書", "住宅ローンの返済予定表", "会社の退職金規程・制度の資料"]) {
      const r = reqs.find((x) => x.doc === doc);
      expect(r, doc).toBeDefined();
      expect(docStartOf(r!), doc).toBeNull();
      expect(readableDoc(doc)).toBe(false);
    }
  });

  it("読んだ記録に、名義の人（決まっていなければ）と、物を書かない候補の書類の物を入れる。新しい物の候補は変えない", () => {
    const wh = open();
    const contract = (wh.request.input.household.insuranceContracts ?? [])[0]!.id;
    const spouse = idOf(wh, "spouse");
    const raw = {
      contract: PROPOSAL_CONTRACT,
      docType: "insurancePolicy",
      objects: [{ key: "c1", kind: "insurance:medical" }],
      values: [
        { item: "insurance.premium", at: ["amount"], value: 16200, period: "once" },
        { item: "insurance.label", newObject: "c1", value: "架空の医療保険" },
        { item: "insurance.contractDate", member: "holder", value: "2012-06" },
      ],
    };
    const r = readProposal(raw, { via: "paste", at: AT, newId, members: members(wh) }).reading!;
    const s = withStart(wh, r, { holder: spouse, object: contract });
    expect(s.holder).toBe(spouse);
    expect(s.candidates.map((c) => c.target.object ?? null)).toEqual([contract, null, null]);
    // 名義の人を選んでいた記録は変えない・世帯に無い人は入れない・入口が無ければそのまま
    expect(withStart(wh, { ...r, holder: idOf(wh, "self") }, { holder: spouse, object: null }).holder).toBe(idOf(wh, "self"));
    expect(withStart(wh, r, { holder: "00000000-0000-4000-8000-999999999999", object: null }).holder).toBeUndefined();
    expect(withStart(wh, r, null)).toBe(r);
    // 物を当てた候補は、その契約の欄に当たる（FP が当てる契約を選ばなくてよい）
    const row = docReview(wh, s).groups.flatMap((g) => g.rows).find((x) => x.id === s.candidates[0]!.id)!;
    expect(row.problem).toBeNull();
  });
});

describe("画面の入口", () => {
  it("書類のお願いの1通ごとの「この書類を読む」は、保険証券だけ（読み取りの入口があるときだけ）", () => {
    const wh = allToDocs(withMedical(open()));
    expect(renderToString(h(DocRequests, { wh, onOpen: noop }))).not.toContain("data-dr-read");
    const html = renderToString(h(DocRequests, { wh, onOpen: noop, onRead: noop }));
    const policies = docRequests(wh).filter((r) => r.doc === "保険証券");
    expect(policies.length).toBeGreaterThan(0);
    expect(docRequests(wh).length).toBeGreaterThan(policies.length);
    expect(html.split("data-dr-read=").length - 1).toBe(policies.length);
    expect(html).toContain("この書類を読む");
  });

  it("書類待ちの印の中に「この書類を読む」（保険証券の欄で、入力のパネルが入口を置いたときだけ）", () => {
    const mark = (ctx: ((k: string) => void) | null, doc: string) => renderToString(h(DocReadContext.Provider, { value: ctx }, h(StateMark, { status: "unknown", basis: "推定", text: "書類待ち", label: "手術（1回の額）", fieldKey: "f1", doc })));
    expect(mark(null, "保険証券")).not.toContain("data-state-read-doc");
    expect(mark(noop, "保険証券")).toContain('data-state-read-doc="f1"');
    expect(mark(noop, "ねんきん定期便")).not.toContain("data-state-read-doc");
    const est = renderToString(h(DocReadContext.Provider, { value: noop }, h(StateMark, { status: "estimated", basis: "推定", text: "推定", label: "加入月数", fieldKey: "f1" })));
    expect(est).not.toContain("data-state-read-doc");
  });

  it("保険の入力項目の見出しに「書類から読む」の1行。年金・ほかの入力項目・入口の無いときは出ない", () => {
    const wh = allToDocs(withMedical(open()));
    const panel = (itemId: string, onReadDoc?: () => void, level: "simple" | "detail" = "simple") => renderToString(h(InputPanel, { wh, itemId, level, onLevel: noop, onSave: noop, onClose: noop, ...(onReadDoc !== undefined ? { onReadDoc } : {}) }));
    const html = panel("insurance", noop);
    expect(html).toContain('data-panel-read-doc="insurance"');
    expect(html).toContain(STAGE_STARTS.insurance!.line);
    expect(panel("insurance")).not.toContain("data-panel-read-doc");
    expect(Object.keys(STAGE_STARTS)).toEqual(["insurance"]);
    for (const id of ["pension", "living"]) expect(panel(id, noop), id).not.toContain("data-panel-read-doc");
    // 保険の書類待ちの欄（詳細の手術の1回の額）の印に「この書類を読む」。年金の書類待ちの欄には出ない
    expect(panel("insurance", noop, "detail")).toContain("data-state-read-doc");
    expect(panel("insurance", undefined, "detail")).not.toContain("data-state-read-doc");
    expect(panel("pension", noop, "detail")).not.toContain("data-state-read-doc");
  });

  it("「この書類を読む」の画面: AI の答えの貼り付けと、名義の人の初めの値を出す。電子データ（XML）の入口は無い", () => {
    const wh = allToDocs(withMedical(open()));
    const policy = docStartOf(docRequests(wh).find((r) => r.doc === "保険証券")!)!;
    const html = renderToString(h(DocumentStart, { wh, start: policy, onPaste: noop, onClose: noop }));
    expect(html).toContain(`この書類を読む: ${policy.title}`);
    expect(html).not.toContain("XML");
    expect(html).toContain("data-documents-start-paste-open");
    expect(html).toContain("「ご本人」にしておきます");
    expect(html).not.toContain("data-documents-start-ai");
    expect(renderToString(h(DocumentStart, { wh, start: policy, onPaste: noop, onAiShare: noop, onClose: noop }))).toMatch(/data-documents-start-ai[^-]/u);
  });

  it("貼り付けの画面は、保険の書類の読み方の手引きを写せる形で開く（書類の種類を選ぶ欄は無い）", () => {
    const wh = open("sampleSingle40s");
    const html = renderToString(h(PasteAnswer, { wh, gate: { ok: true, sample: true }, guide: { options: GUIDE_DOC_TYPES, text: guideText }, initialGuide: "insurancePolicy", onRead: noop, onClose: noop }));
    expect(html).toContain('data-documents-paste-guide-type="insurancePolicy"');
    expect(html).toContain("data-documents-paste-guide");
  });
});

describe("読み方の手引き", () => {
  it("保険の書類の手引きを写せる", () => {
    expect(guideText("insurancePolicy")).toContain("保険証券・ご契約内容のお知らせ・設計書の読み方");
  });
});
