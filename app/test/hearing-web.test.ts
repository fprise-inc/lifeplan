// Web のヒアリング（0125）の FP の側（workspace/hearing/web.ts）: 発行 → お客さまが答えて書類を送る → 受け取る → サーバーから消す →
// Excel と同じ候補にして承認 → 現状に入る。元に戻すで依頼の記録を戻さない。事務所のひな形。書類待ちとのつながり
import { describe, expect, it } from "vitest";
import { handleApi } from "../../hearing/relay/handler.ts";
import { memoryStore } from "../../hearing/relay/store.ts";
import { answersOf, draftKey, initialDraft, openRequest, submitAnswers, uploadFile, type Draft, type RelayTransport } from "../../hearing/src/web/index.ts";
import { API_PREFIX } from "../../hearing/src/web/protocol.ts";
import { applyImport, approvalTime, defaultSelection } from "../src/workspace/hearing/sheet.ts";
import { docRequestStatus, documentFromTemplate, importWeb, invitationText, issueWeb, keepWebLog, markImported, officeFace, previewPacket, readHearingTemplates, receiveWeb, receivedDocuments, removeOnServer, statusOf, templateSelection, webLog, withCustom, withoutFile } from "../src/workspace/hearing/web.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { readOfficeSettings, withHearingTemplates, DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import { modelHousehold } from "./helpers.ts";

const OFFICE = officeFace({ name: "【架空】みらいFP事務所", color: "#2f6f5e", purpose: "ライフプランの作成のため", privacyContact: "" });
const NOW = new Date("2026-11-05T09:00:00Z");

let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const blank = (): WorkingHousehold => withRefreshedEstimates(blankHousehold("2026-11", seq));

function relayFor() {
  const store = memoryStore();
  const t: RelayTransport = async (r) => {
    const headers: Record<string, string> = {};
    if (r.token !== undefined) headers.authorization = `Bearer ${r.token}`;
    const res = await handleApi(new Request(`https://relay.test${API_PREFIX}${r.path}`, { method: r.method, headers, ...(r.body !== undefined ? { body: r.body } : {}) }), { store, now: () => NOW });
    return { status: res.status, body: await res.text() };
  };
  return { store, t };
}

const v = (text: string) => ({ status: "value" as const, raw: { kind: "text" as const, text } });
const ym = (y: number, m: number) => ({ status: "value" as const, raw: { kind: "text" as const, text: String(y) }, raw2: { kind: "number" as const, text: String(m) } });
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 2000 }, (_, i) => i % 200)]) as Uint8Array<ArrayBuffer>;

async function customerAnswers(url: string, t: RelayTransport, withPhoto = true) {
  const o = await openRequest(new URL(url).hash, t);
  let d: Draft = initialDraft(o.packet);
  d = { ...d, gates: { spouse: 0, child: 1 }, answers: { [draftKey("hs.consent.purpose")]: v("given"), [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1985, 6), [draftKey("hs.family.adult.sex", 1)]: v("male"), [draftKey("hs.family.child.birthYearMonth", 1)]: ym(2019, 2), [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.income.annual", 1)]: { status: "value", raw: { kind: "number", text: "600" } }, [draftKey("hs.housing.type")]: v("rent"), [draftKey("hs.housing.rent")]: { status: "value", raw: { kind: "number", text: "110000" } } } };
  if (withPhoto) {
    const up = await uploadFile(o, jpeg, t);
    d = { ...d, documents: { d1: { status: "attached", files: [{ fileId: up.fileId, mime: "image/jpeg", bytes: jpeg.length, sha256: up.sha256, label: "写真 1" }] } } };
  }
  await submitAnswers(o, answersOf(o.packet, d, new Date("2026-11-06T09:00:00Z")), t);
}

describe("Web のヒアリング（FP の側）", () => {
  it("発行した依頼の記録は世帯に入り、受け取ると答えと書類が世帯に入る。消すとサーバーから消え、取り込みは承認したものだけ現状に入る", async () => {
    const { t, store } = relayFor();
    const sel0 = withCustom(templateSelection("first", blank()), "ご相談のきっかけは", "");
    const sel = { ...sel0, documents: [documentFromTemplate(sel0, "withholding", "ご本人")] };
    const r = await issueWeb(blank(), { selection: sel, customerNo: "A0042", office: OFFICE, days: 14, pageUrl: "https://relay.test/h/", transport: t, now: NOW, random: new Uint8Array([1, 2, 3, 4, 5, 6]) });
    let wh = r.wh;
    expect(webLog(wh)).toHaveLength(1);
    expect(statusOf(r.entry, NOW)).toBe("issued");
    expect(statusOf(r.entry, new Date("2026-11-20T09:00:00Z"))).toBe("expired");
    // 案内文: URL・期限・名前を書かない・転送しない（顧客番号・金額は入れない）
    const msg = invitationText(r.entry, "【架空】みらいFP事務所");
    expect(msg).toContain(r.entry.record.url);
    expect(msg).toContain("転送しないでください");
    expect(msg).not.toContain("A0042");

    // まだ答えが無ければ受け取らない
    expect(await receiveWeb(wh, r.entry, t, NOW)).toBeNull();
    await customerAnswers(r.entry.record.url, t);
    const got = await receiveWeb(wh, r.entry, t, NOW);
    expect(got).not.toBeNull();
    wh = got!.wh;
    const e = webLog(wh)[0]!;
    expect(e.state).toBe("received");
    expect(e.files).toHaveLength(1);
    expect(receivedDocuments(wh)[0]?.files).toHaveLength(1);
    await removeOnServer(e, t);
    expect(store.size()).toBe(0);

    // 取り込み: Excel と同じ候補の画面。承認すると現状に入り、取り込み済みの印が付く
    const view = importWeb(wh, e, "0.1.0", seq);
    const members = view.candidates.filter((c) => c.group === "家族");
    expect(members.length).toBe(2);
    expect(view.memo.some((m) => m.includes("ご相談のきっかけは"))).toBe(false);
    const applied = applyImport(wh, view, defaultSelection(view), approvalTime(new Date(2026, 10, 6, 10, 0, 0)));
    const done = markImported(applied.wh, e.record.requestId, "2026-11-06T10:00:00+09:00");
    expect(done.request.input.household.members.filter((m) => m.kind === "self" || m.kind === "child")).toHaveLength(2);
    expect(webLog(done)[0]?.state).toBe("imported");
    expect(done.hearing?.imports.at(-1)?.requestId).toBe(e.record.requestId);
    // 写し終えた書類を消す
    expect(webLog(withoutFile(done, e.record.requestId, e.files![0]!.fileId))[0]?.files).toHaveLength(0);
  });

  it("元に戻す・やり直すで、依頼の記録（鍵・受け取った答え）を前の状態に戻さない", async () => {
    const { t } = relayFor();
    const before = blank();
    const r = await issueWeb(before, { selection: templateSelection("first", before), customerNo: "A1", office: OFFICE, days: 7, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    const restored = keepWebLog(before, r.wh);
    expect(webLog(restored)).toHaveLength(1);
    expect(keepWebLog(r.wh, before).hearing?.web).toBeUndefined();
  });

  it("見直し: 今の世帯に値のある項目は「確かめてもらう」から始まり、見本の問いに今の値が入る", async () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const sel = templateSelection("review", wh);
    const confirm = sel.sections.flatMap((s) => s.items).filter((i) => i.mode === "confirm");
    expect(confirm.length).toBeGreaterThan(5);
    const p = await previewPacket(wh, sel, OFFICE, 30, NOW);
    const birth = p.items.find((i) => i.key === "hs.family.adult.birthYearMonth");
    expect(birth?.confirm).toBe(true);
    expect(Object.keys(birth?.prefill ?? {})).toContain("1");
    expect(initialDraft(p).gates.spouse).toBe(1);
  });

  it("書類待ちの1通と結びつけた書類は、頼んだ・届いたが書類のお願いの一覧で分かる", async () => {
    const { t } = relayFor();
    const sel0 = templateSelection("first", blank());
    const doc = { ...documentFromTemplate(sel0, "pensionNotice", "ご本人"), docRequest: "ねんきん定期便|m1" };
    const r = await issueWeb(blank(), { selection: { ...sel0, documents: [doc] }, customerNo: "A1", office: OFFICE, days: 7, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    expect(docRequestStatus(r.wh, NOW).get("ねんきん定期便|m1")).toEqual({ requested: true, files: 0, answer: null });
    await customerAnswers(r.entry.record.url, t);
    const got = await receiveWeb(r.wh, r.entry, t, NOW);
    expect(docRequestStatus(got!.wh, NOW).get("ねんきん定期便|m1")?.files).toBe(1);
  });

  it("事務所のひな形は事務所の既定値に入り、読み直しても残る（形の違うものは捨てる）", () => {
    const sel = templateSelection("detail", blank());
    const s = withHearingTemplates(DEFAULT_OFFICE_SETTINGS, [{ name: "詳細・子育て世帯", selection: sel }]);
    const back = readOfficeSettings(JSON.parse(JSON.stringify(s)));
    expect(back.hearingTemplates?.[0]?.name).toBe("詳細・子育て世帯");
    expect(readHearingTemplates([{ name: "x", selection: { base: { sheetId: "nope", version: 9 }, sections: [], custom: [], documents: [] } }, { name: "" }])).toEqual([]);
    expect(withHearingTemplates(s, []).hearingTemplates).toBeUndefined();
  });
});
