// 「この書類を読む」の入口（0154 の3）: 書類のお願いの1通・書類待ちの欄・保険の見出しから、その書類の読み取りへ進む。
// 画面に入口が出る（プランの編集中は出ない）。読み方は AI で読み取る（保存した世帯）・架空の見本で試す（見本の世帯）・欄に打つ。
// AI の答えを貼り付ける道は、利用者の判断（2026-11-20）でなくした（0151 の追記）。
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
import { DocumentStart } from "../src/workspace/documents/DocumentStart.tsx";
import { createObject } from "../src/workspace/documents/apply.ts";
import { docStartOf, readableDoc, STAGE_STARTS } from "../src/workspace/documents/start.ts";
import { modelHousehold } from "./helpers.ts";

const noop = () => undefined;
const open = (id = "salariedCoupleTwoKids"): WorkingHousehold => fromRequest(modelHousehold(id));

/** 医療保険（手術の特約つき）を1件足した世帯 */
const withMedical = (wh: WorkingHousehold): WorkingHousehold => createObject(wh, "insurance:medical")!.wh;

/** 書類で確かめる欄を全部「書類で確かめる」にする */
function allToDocs(wh0: WorkingHousehold): WorkingHousehold {
  let wh = wh0;
  for (let pass = 0; pass < 3; pass++)
    for (const st of buildStages(wh)) for (const f of allFields(st)) if (f.docCheck !== undefined && availableOps(f, wh).includes("unknown")) wh = applyStateOp(wh, f, "unknown");
  return wh;
}

describe("入口", () => {
  it("書類のお願いの1通のうち、保険証券だけに読み取りの入口を作る。ほかの書類は入口を作らない", () => {
    const wh = allToDocs(withMedical(open()));
    const reqs = docRequests(wh);
    const policy = reqs.find((r) => r.doc === "保険証券")!;
    expect(readableDoc(policy.doc)).toBe(true);
    expect(docStartOf(policy)).toEqual({ title: policy.title, docType: "insurancePolicy" });
    for (const doc of ["ねんきん定期便", "住民税の決定通知書", "住宅ローンの返済予定表", "会社の退職金規程・制度の資料"]) {
      const r = reqs.find((x) => x.doc === doc);
      expect(r, doc).toBeDefined();
      expect(docStartOf(r!), doc).toBeNull();
      expect(readableDoc(doc)).toBe(false);
    }
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

  it("「この書類を読む」の画面: 保存した世帯は AI で読み取る、見本の世帯は架空の見本で試す。貼り付け・電子データ（XML）の道は無い", () => {
    const wh = allToDocs(withMedical(open()));
    const policy = docStartOf(docRequests(wh).find((r) => r.doc === "保険証券")!)!;
    const stored = renderToString(h(DocumentStart, { wh, start: policy, ai: { connected: false, onOpen: noop }, onClose: noop }));
    expect(stored).toContain(`この書類を読む: ${policy.title}`);
    expect(stored).not.toContain("XML");
    expect(stored).not.toContain("貼り付け");
    expect(stored).not.toContain("data-documents-start-paste");
    expect(stored).toMatch(/data-documents-start-ai[^-]/u);
    expect(stored).toContain("AI と接続する");
    expect(stored).not.toContain("data-documents-start-samples");
    expect(stored).toContain("書類の名義の人も、その画面で選びます");
    expect(renderToString(h(DocumentStart, { wh, start: policy, ai: { connected: true, onOpen: noop }, onClose: noop }))).toContain("この世帯を AI に渡す");
    // 見本の世帯（保存していない。AI に渡せない）: AI のボタンは出さず、架空の見本で試せる
    const sample = renderToString(h(DocumentStart, { wh, start: policy, onSamples: noop, onClose: noop }));
    expect(sample).not.toContain("data-documents-start-ai-open");
    expect(sample).toContain("見本の世帯は AI に渡せません");
    expect(sample).toContain("data-documents-start-samples-open");
    // 保存していない新しい世帯: 保存してから使うことを書く
    const unsaved = renderToString(h(DocumentStart, { wh, start: policy, onClose: noop }));
    expect(unsaved).toContain("保存していない世帯は AI に渡せません");
    expect(unsaved).not.toContain("data-documents-start-samples");
  });
});
