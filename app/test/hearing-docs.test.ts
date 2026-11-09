// 受け取った書類を FP が見て使う所（0191）: 世帯ごとの一覧（何を・誰の・いつ・大きさ・見た・保存した）・保存のファイル名の決まり・
// 入力項目と書類のつながり・見た／保存したの印・FP が消したときだけ消える・画面（一覧と入力のパネルの入口）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { documentFromCheck, documentFromTemplate, templateSelection, webLog, withWebEntry, type StoredDocumentFile, type WebLogEntry } from "../src/workspace/hearing/web.ts";
import { byDocument, DOC_CARDS, docFileName, docNameParts, fileNames, filesForCard, receivedFiles, receivedSummary, sizeText, withFileMarks, withoutFiles } from "../src/workspace/hearing/receivedDocs.ts";
import { DocLinks, ReceivedDocs, type ReceivedDocsState } from "../src/workspace/hearing/ReceivedDocs.tsx";
import { DOCUMENT_TEMPLATES, OWNER_LABEL } from "../../hearing/src/web/documents.ts";
import type { RequestedDocument, WebSelection } from "../../hearing/src/web/packet.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import type { DocRequest } from "../src/workspace/input/docRequests.ts";

let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const blank = (): WorkingHousehold => withRefreshedEstimates(blankHousehold("2026-11", seq));

const file = (docId: string, fileId: string, mime: StoredDocumentFile["mime"], bytes: number, batchId?: string): StoredDocumentFile => ({ docId, fileId, mime, data: "AAAA", bytes, sha256: "x".repeat(64), ...(batchId !== undefined ? { batchId } : {}) });

/** 依頼の記録を1件（書類3通: 源泉徴収票〔ご本人〕・ねんきん定期便〔書類待ちの1通と結びつく〕・独自の書類）。受け取りは2回 */
function household(): { wh: WorkingHousehold; docs: RequestedDocument[] } {
  const base = blank();
  const sel0 = templateSelection("simple", base);
  const d1 = documentFromTemplate(sel0, "withholding", "ご本人");
  const sel1: WebSelection = { ...sel0, documents: [d1] };
  const pending: DocRequest = { id: "ねんきん定期便|m1", doc: "ねんきん定期便", whose: "ご本人", title: "ねんきん定期便（ご本人）", values: [], holder: "m1", object: null };
  const d2 = documentFromCheck(sel1, pending);
  const d3: RequestedDocument = { id: "d3", kind: null, title: "健康診断の結果", purpose: "", where: "" };
  const docs = [d1, d2, d3];
  const entry = {
    record: { kind: "web", requestId: "R-ABC123", serverId: "s", secrets: {} as never, selection: { ...sel0, documents: docs }, digest: "", customerNo: "A0042", issuedAt: "2026-11-01T01:00:00Z", expiresAt: "2026-12-01T01:00:00Z", limitAt: "2027-01-30T01:00:00Z", url: "https://relay.test/h/#x" },
    state: "received",
    received: { at: "2026-11-06T03:00:00Z", submittedAt: "2026-11-05T12:00:00Z", answers: [], documents: [], gates: {}, dropped: 0 },
    files: [file("d1", "f1", "image/jpeg", 300_000, "b1"), file("d1", "f2", "image/jpeg", 200_000, "b1"), file("d2", "f3", "application/pdf", 2_400_000, "b2"), file("d3", "f4", "image/png", 1000, "b2")],
    batches: [
      { batchId: "b1", sentAt: "2026-11-05T12:00:00Z", receivedAt: "2026-11-06T03:00:00Z", documents: [{ id: "d1", files: 2 }], missingFiles: 0 },
      { batchId: "b2", sentAt: "2026-11-07T12:00:00Z", receivedAt: "2026-11-08T03:00:00Z", documents: [{ id: "d2", files: 1 }, { id: "d3", files: 1 }], missingFiles: 0 },
    ],
  } as unknown as WebLogEntry;
  return { wh: withWebEntry(base, entry), docs };
}

describe("受け取った書類（0191）", () => {
  it("一覧: 何を・誰の・いつ受け取ったか・大きさ。新しく受け取った順。前の版の記録（送りの番号が無い）は答えを受け取った日時", () => {
    const { wh } = household();
    const list = receivedFiles(wh);
    expect(list.map((r) => [r.name, r.whose, r.receivedAt, r.file.bytes])).toEqual([
      ["ねんきん定期便", "ご本人", "2026-11-08T03:00:00Z", 2_400_000],
      ["健康診断の結果", null, "2026-11-08T03:00:00Z", 1000],
      ["源泉徴収票", "ご本人", "2026-11-06T03:00:00Z", 300_000],
      ["源泉徴収票", "ご本人", "2026-11-06T03:00:00Z", 200_000],
    ]);
    expect(list.find((r) => r.file.fileId === "f2")).toMatchObject({ index: 2, count: 2, sentAt: "2026-11-05T12:00:00Z" });
    expect(receivedSummary(list)).toEqual({ files: 4, bytes: 2_901_000, unseen: 4, unsaved: 4 });
    expect(sizeText(2_901_000)).toBe("2.8MB");
    expect(sizeText(1000)).toBe("1KB");
    // 送りの番号の無いファイル（0.70 より前に受け取ったもの）
    const e = webLog(wh)[0] as WebLogEntry;
    const old = withWebEntry(wh, { ...e, files: [file("d1", "f9", "image/jpeg", 10)] });
    expect(receivedFiles(old)[0]?.receivedAt).toBe("2026-11-06T03:00:00Z");
  });

  it("書類の名前はひな形の定義から引き、見出しの括弧を持ち主とみる。ひな形の名前の中の括弧は持ち主にしない", () => {
    const sel = templateSelection("simple", blank());
    for (const t of DOCUMENT_TEMPLATES) {
      const d = documentFromTemplate(sel, t.kind, "配偶者");
      expect(docNameParts(d)).toEqual({ name: t.title, whose: d.owner !== undefined ? OWNER_LABEL[d.owner] : null });
      expect(docNameParts(documentFromTemplate(sel, t.kind))).toEqual({ name: t.title, whose: null });
    }
    // 書類待ちの1通の言い分け（自動車ローンの返済予定表）・保険の契約の持ち主
    expect(docNameParts({ id: "d1", kind: "loanSchedule", title: "自動車ローンの返済予定表（ご本人）", purpose: "", where: "", docRequest: "返済予定表|debt1" })).toEqual({ name: "自動車ローンの返済予定表", whose: "ご本人" });
    expect(docNameParts({ id: "d1", kind: "insurancePolicy", title: "保険証券（医療保険・ご本人）", purpose: "", where: "" })).toEqual({ name: "保険証券", whose: "医療保険・ご本人" });
    // 頼む書類の持ち主の欄（owner）があれば、その言葉を使う
    expect(docNameParts({ id: "d1", kind: "withholding", title: "源泉徴収票（配偶者の方）", purpose: "", where: "", owner: "spouse" })).toEqual({ name: "源泉徴収票", whose: "配偶者の方" });
    expect(docNameParts({ id: "d1", kind: null, title: "健康診断の結果（ご本人）", purpose: "", where: "", owner: "self" })).toEqual({ name: "健康診断の結果", whose: "ご本人" });
  });

  it("保存のファイル名: 顧客番号_書類の名前_持ち主_受け取った日。お名前は入らない。同じ日の同じ書類は2枚目から _2。後から届いても前の名前は変わらない", () => {
    const { wh } = household();
    const list = receivedFiles(wh);
    const names = fileNames(list);
    expect(names.get("f1")).toBe("A0042_源泉徴収票_ご本人_20261106.jpg");
    expect(names.get("f2")).toBe("A0042_源泉徴収票_ご本人_20261106_2.jpg");
    expect(names.get("f3")).toBe("A0042_ねんきん定期便_ご本人_20261108.pdf");
    expect(names.get("f4")).toBe("A0042_健康診断の結果_20261108.png");
    // 使えない字・括弧・空白は _ に（フォルダを指せない）
    const r = list[0]!;
    expect(docFileName({ ...r, name: "給与明細（最近の1か月分）", whose: "ご本人/配偶者", customerNo: "A 01" })).toBe("A_01_給与明細_最近の1か月分_ご本人_配偶者_20261108.pdf");
    // 名前が重なったら、後に受け取ったものに番号を足す（一覧の並びによらない）
    const later = { ...r, requestId: "R-OTHER", receivedAt: "2026-11-08T05:00:00Z", file: { ...r.file, fileId: "zz" } };
    const twice = fileNames([later, r]);
    expect([twice.get(r.file.fileId), twice.get("zz")]).toEqual(["A0042_ねんきん定期便_ご本人_20261108.pdf", "A0042_ねんきん定期便_ご本人_20261108_2.pdf"]);
    // 同じ日に同じ書類がもう1枚届いても、前の名前は変わらない
    const e = webLog(wh)[0] as WebLogEntry;
    const more = withWebEntry(wh, { ...e, files: [...(e.files ?? []), file("d2", "f5", "application/pdf", 10, "b3")], batches: [...(e.batches ?? []), { batchId: "b3", sentAt: "2026-11-08T04:00:00Z", receivedAt: "2026-11-08T06:00:00Z", documents: [{ id: "d2", files: 1 }], missingFiles: 0 }] });
    const after = fileNames(receivedFiles(more));
    expect(after.get("f3")).toBe("A0042_ねんきん定期便_ご本人_20261108.pdf");
    expect(after.get("f5")).toBe("A0042_ねんきん定期便_ご本人_20261108_2.pdf");
  });

  it("入力項目と書類のつながり: 書類の種類から引く（源泉徴収票 → 働き方と収入）。書類待ちの1通と結びついた書類は、その欄の入力項目からも引く", () => {
    const { wh } = household();
    const list = receivedFiles(wh);
    expect(byDocument(filesForCard(list, "work", [])).map((g) => [g.name, g.files.length])).toEqual([["源泉徴収票", 2]]);
    expect(filesForCard(list, "pension", []).map((r) => r.name)).toEqual(["ねんきん定期便"]);
    expect(filesForCard(list, "family", [])).toEqual([]);
    // 独自の書類でも、書類待ちの1通と結びついていれば、その欄の入力項目で出る
    const e = webLog(wh)[0] as WebLogEntry;
    const custom: RequestedDocument = { id: "d3", kind: null, title: "健康診断の結果", purpose: "", where: "", docRequest: "保険証券|c1" };
    const w2 = withWebEntry(wh, { ...e, record: { ...e.record, selection: { ...e.record.selection, documents: [...e.record.selection.documents.slice(0, 2), custom] } } });
    const pending = [{ id: "保険証券|c1", values: [{ card: "insurance" }] } as unknown as DocRequest];
    expect(filesForCard(receivedFiles(w2), "insurance", pending).map((r) => r.name)).toEqual(["健康診断の結果"]);
    // 今の公式のひな形は、どれも見ながら打つ入力項目がある。表に無い種類（後で増えた書類）も、一覧と見る枠には出る（入力のパネルの入口だけ出ない）
    // （今ある種類だけを数える。後で増えた種類は、表に無くても一覧と見る枠には出るので、このテストは落とさない）
    const now = ["withholding", "payslip", "bonusSlip", "taxReturn", "companyAccounts", "residentTaxNotice", "retirementRules", "pensionNotice", "pensionAmountNotice", "dcNotice", "deposits", "securities", "investStatement", "insurancePolicy", "insuranceDeduction", "loanSchedule", "otherLoanSchedule", "propertyTax", "rentalContract", "householdBook"];
    for (const t of DOCUMENT_TEMPLATES.filter((x) => now.includes(x.kind))) expect(DOC_CARDS[t.kind]?.length ?? 0, t.kind).toBeGreaterThan(0);
    const unknown: RequestedDocument = { id: "d3", kind: "somethingNew", title: "新しい書類（ご本人）", purpose: "", where: "" };
    const w3 = withWebEntry(wh, { ...e, record: { ...e.record, selection: { ...e.record.selection, documents: [...e.record.selection.documents.slice(0, 2), unknown] } } });
    expect(receivedFiles(w3).find((r) => r.doc.id === "d3")).toMatchObject({ name: "新しい書類", whose: "ご本人" });
    expect(["work", "pension", "insurance", "housing", "savings"].some((c) => filesForCard(receivedFiles(w3), c, []).some((r) => r.doc.id === "d3"))).toBe(false);
  });

  it("見た・保存したの印を付ける（見たは最初の日時のまま・保存したは最後の日時）。FP が消したときだけ消える", () => {
    const { wh } = household();
    let w = withFileMarks(wh, ["f1"], "viewedAt", "2026-11-08T04:00:00Z");
    w = withFileMarks(w, ["f1"], "viewedAt", "2026-11-08T05:00:00Z");
    w = withFileMarks(w, ["f1", "f3"], "savedAt", "2026-11-08T04:00:00Z");
    w = withFileMarks(w, ["f3"], "savedAt", "2026-11-08T06:00:00Z");
    const files = webLog(w)[0]?.files ?? [];
    expect(files.find((f) => f.fileId === "f1")).toMatchObject({ viewedAt: "2026-11-08T04:00:00Z", savedAt: "2026-11-08T04:00:00Z" });
    expect(files.find((f) => f.fileId === "f3")).toMatchObject({ savedAt: "2026-11-08T06:00:00Z" });
    expect(receivedSummary(receivedFiles(w))).toMatchObject({ unseen: 3, unsaved: 2 });
    // 同じ印なら世帯を変えない（保存のたびに書き戻さない）
    expect(withFileMarks(w, ["f1"], "viewedAt", "2026-11-09T00:00:00Z")).toBe(w);
    // 消す（FP が押したときだけ）。依頼の送りの記録は残る
    const gone = withoutFiles(w, ["f1", "f4"]);
    expect(webLog(gone)[0]?.files?.map((f) => f.fileId)).toEqual(["f2", "f3"]);
    expect(webLog(gone)[0]?.batches).toHaveLength(2);
  });

  it("画面: 一覧に何を・誰の・いつ・大きさ・見た・保存したが並び、まとめて保存のボタンが出る。消すは押してから確かめる。入力のパネルの入口は、その入力項目の書類だけ", () => {
    const { wh } = household();
    const w = withFileMarks(withFileMarks(wh, ["f1"], "viewedAt", "2026-11-08T04:00:00Z"), ["f1"], "savedAt", "2026-11-08T04:00:00Z");
    const files = receivedFiles(w);
    const rd: ReceivedDocsState = { files, names: fileNames(files), viewing: null, view: () => undefined, listOpen: true, setListOpen: () => undefined, markViewed: () => undefined, canSave: true, save: async () => "", remove: () => undefined, note: null, pending: [] };
    const html = renderToString(h(ReceivedDocs, { rd }));
    expect(html).toContain("4件・2.8MB");
    expect(html).toContain("まだ見ていない 3件・まだ保存していない 3件");
    expect(html).toContain("まだ保存していない書類を保存（3件）");
    expect(html).toContain("全部を保存（4件）");
    expect(html.match(/data-received-file=/g)).toHaveLength(4);
    expect(html).toContain('data-received-viewed="1"');
    expect(html).toContain('data-received-saved="1"');
    expect(html).toContain("ねんきん定期便");
    expect(html).not.toContain("data-received-delete-yes");
    // 自動で消す・消すように促す文は出さない
    expect(html).not.toContain("消してよいですか");
    // 保存の口が無いとき（見本の世帯など）は保存のボタンを出さない
    expect(renderToString(h(ReceivedDocs, { rd: { ...rd, canSave: false } }))).not.toMatch(/data-received-save(=|-all|-unsaved)/);
    // 入力のパネルの入口
    const links = renderToString(h(DocLinks, { rd, card: "work" }));
    expect(links).toContain("源泉徴収票（ご本人）を見る（2枚）");
    expect(links).not.toContain("ねんきん定期便");
    expect(renderToString(h(DocLinks, { rd, card: "family" }))).toBe("");
  });
});
