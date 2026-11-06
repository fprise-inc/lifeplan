// Web のヒアリング（0125）の FP の側（workspace/hearing/web.ts）: 発行 → お客さまが答えて書類を送る → 受け取る → サーバーから消す →
// Excel と同じ候補にして承認 → 現状に入る。元に戻すで依頼の記録を戻さない。事務所のひな形。書類待ちとのつながり
import { describe, expect, it } from "vitest";
import { handleApi } from "../../hearing/relay/handler.ts";
import { memoryStore } from "../../hearing/relay/store.ts";
import { answersOf, draftKey, initialDraft, openRequest, submitAnswers, uploadFile, type Draft, type RelayTransport } from "../../hearing/src/web/index.ts";
import { API_PREFIX } from "../../hearing/src/web/protocol.ts";
import { applyImport, approvalTime, defaultSelection } from "../src/workspace/hearing/sheet.ts";
import { docRequestStatus, documentFromTemplate, importWeb, invitationText, issueWeb, keepWebLog, markImported, officeFace, previewPacket, readHearingTemplates, receiveWeb, receivedDocuments, removeOnServer, sentAtText, STATUS_TEXT, statusOf, templateSelection, webLog, withCustom, withoutFile } from "../src/workspace/hearing/web.ts";
import type { DraftAnswer } from "../../hearing/src/web/flow.ts";
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

// ---- 取り込みで今の値を壊さない（値の入った世帯に「初回の前」で聞いて取り込む） ----

const num = (text: string) => ({ status: "value" as const, raw: { kind: "number" as const, text } });

/** 値の入った世帯（夫婦と子2人。預貯金 800万円・住宅ローン 残高 2,240万円・生活費 月30万円） */
const filled = (): WorkingHousehold => fromRequest(modelHousehold("salariedCoupleTwoKids"));

/** 「初回の前」の URL を発行し、お客さまが答えて送り、FP が受け取ったところまで */
async function answeredWeb(wh: WorkingHousehold, answers: Record<string, DraftAnswer>, gates: Record<string, number> = { spouse: 1, child: 2 }, submittedAt = new Date("2026-11-06T13:15:00Z")) {
  const { t } = relayFor();
  const r = await issueWeb(wh, { selection: templateSelection("first", wh), customerNo: "A1", office: OFFICE, days: 14, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
  const o = await openRequest(new URL(r.entry.record.url).hash, t);
  const d0 = initialDraft(o.packet);
  const d: Draft = { ...d0, gates: { ...d0.gates, ...gates }, answers: { [draftKey("hs.consent.purpose")]: v("given"), ...answers } };
  await submitAnswers(o, answersOf(o.packet, d, submittedAt), t);
  const got = await receiveWeb(r.wh, r.entry, t, NOW);
  if (got === null) throw new Error("受け取れない");
  return got;
}

describe("取り込みで今の値を壊さない", () => {
  it("「あとで」・空欄の項目は、今の値を空欄・0円・目安で上書きしない（候補にせず「お答えなし」。知らせの「0円として計算します」も出さない）", async () => {
    const wh = filled();
    const got = await answeredWeb(wh, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7), [draftKey("hs.assets.depositTotal")]: { status: "later" } });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const deposit = view.candidates.find((c) => c.group === "貯蓄・投資");
    expect(deposit?.kind).toBe("noAnswer");
    expect(deposit?.fields[0]?.diffs[0]).toMatchObject({ current: "8,000,000円", kept: true });
    // 生活費（空欄・目安）も今の値のまま
    expect(view.candidates.find((c) => c.group === "生活費")?.kind).toBe("noAnswer");
    const sel = defaultSelection(view);
    expect(view.candidates.filter((c) => c.kind === "noAnswer").some((c) => sel.has(c.id))).toBe(false);
    expect([...view.issues.map((i) => i.message), ...view.checklist.map((c) => c.message)].some((m) => m.includes("0円として計算します"))).toBe(false);
    // FP が全部にチェックを入れても、お答えなしの物は入れない
    const all = new Set(view.candidates.map((c) => c.id));
    const h = applyImport(got.wh, view, all, AT_WEB).wh.request.input.household;
    expect((h.accounts ?? []).find((a) => a.kind === "deposit")?.marketValue).toMatchObject({ value: 8000000, state: "confirmed" });
    expect(h.livingExpenses?.[0]?.monthly).toMatchObject({ value: 300000, state: "confirmed" });
    expect(h.members.find((m) => m.kind === "spouse")?.birth.birthYearMonth).toBe("1983-10");
  });

  it("粗い答え（毎月の返済額だけ・残高は「わからない」）で置いた仮のローンは、詳しく入れてあったローンを既定で残す。候補には「今 → 届いた値」が並ぶ", async () => {
    const wh = filled();
    const got = await answeredWeb(wh, { [draftKey("hs.housing.type")]: v("own"), [draftKey("hs.loan.monthlyTotal")]: num("98000"), [draftKey("hs.loan.balanceTotal")]: { status: "unknown" } });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const loan = view.candidates.find((c) => c.group === "住宅ローン");
    expect(loan?.kind).toBe("changed");
    expect(loan?.keep).toContain("今の値の方が詳しいので残します");
    expect(defaultSelection(view).has(loan?.id ?? "")).toBe(false);
    const diffs = loan?.fields.flatMap((f) => f.diffs) ?? [];
    expect(diffs.find((d) => d.label === "残高")).toMatchObject({ current: "22,400,000円", next: "わからない", rough: true });
    expect(diffs.find((d) => d.label === "借入額")).toMatchObject({ current: "32,000,000円", rough: true });
    const out = applyImport(got.wh, view, defaultSelection(view), AT_WEB).wh.request.input.household;
    expect(out.debts?.[0]).toMatchObject({ principal: 32000000, balance: { value: 22400000, state: "confirmed" }, start: { at: "2016-04" } });
  });

  it("範囲の答えも、確定の今の値を既定で残す（Excel と同じ候補の画面）", async () => {
    const wh = filled();
    const got = await answeredWeb(wh, { [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.income.annualRange", 1)]: v("600〜700万円") });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const work = view.candidates.find((c) => c.title === "ご本人の仕事と収入");
    expect(work?.keep).not.toBeNull();
    expect(work?.fields.flatMap((f) => f.diffs).find((d) => d.label === "給与")).toMatchObject({ current: "6,200,000円", rough: true });
    expect(defaultSelection(view).has(work?.id ?? "")).toBe(false);
  });

  it("答えた欄だけが変わる: 答えの無い欄（性別・仕事を始めた年月など）は、承認しても今の値と今の仮の印のまま", async () => {
    const base = filled();
    // ご本人を女性にしておく（性別を答えないと、取り込みの初めの値は男性）
    const wh: WorkingHousehold = { ...base, request: { ...base.request, input: { ...base.request.input, household: { ...base.request.input.household, members: base.request.input.household.members.map((m) => (m.kind === "self" ? { ...m, sex: "female" as const } : m)) } } } };
    // 配偶者の方は年収だけ答える（生年月は答えない → 仮の値〔ご本人と同じ年月〕で補うが、今の生年月を残す）
    const got = await answeredWeb(wh, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1980, 1), [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.income.annual", 1)]: num("900"), [draftKey("hs.income.annual", 2)]: num("120") });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const self = view.candidates.find((c) => c.title === "ご本人");
    expect(self?.kind).toBe("changed");
    const work = view.candidates.find((c) => c.title === "ご本人の仕事と収入");
    expect(work?.kind).toBe("changed");
    expect(work?.keep).toBeNull();
    expect(work?.fields.flatMap((f) => f.diffs).find((d) => d.label === "仕事を始めた年月")).toMatchObject({ current: "2004年4月", kept: true });
    const sel = defaultSelection(view);
    expect(sel.has(self?.id ?? "")).toBe(true);
    expect(sel.has(work?.id ?? "")).toBe(true);
    const out = applyImport(got.wh, view, sel, AT_WEB).wh;
    const h = out.request.input.household;
    const me = h.members.find((m) => m.kind === "self");
    expect(me).toMatchObject({ sex: "female", birth: { birthYearMonth: "1980-01" } });
    const p = (h.employmentPeriods ?? []).find((x) => x.member === me?.id);
    expect(p?.salary?.annual).toMatchObject({ value: expect.any(Number) as number });
    expect(p?.from).toEqual({ at: "2004-04" });
    expect(view.candidates.find((c) => c.title === "配偶者")?.kind).toBe("noAnswer");
    expect(h.members.find((m) => m.kind === "spouse")?.birth.birthYearMonth).toBe("1983-10");
    expect(out.assumed[`work/period/${p?.id ?? ""}/from`]).toBeUndefined();
  });

  it("Web の答えでは「記入の年月が計算基準月より後」を出さない（送った月はお客さまが選んだ年月でない）。1年を超えて離れたときだけ出す", async () => {
    const wh = filled();
    expect(wh.request.input.baseMonth).toBe("2026-10");
    const got = await answeredWeb(wh, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7) });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const later = (vw: typeof view) => [...vw.issues.map((i) => i.message), ...vw.checklist.map((c) => c.message)].filter((m) => m.includes("計算基準月") && m.includes("後です"));
    expect(later(view)).toEqual([]);
    const far = await answeredWeb(wh, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7) }, { spouse: 1, child: 2 }, new Date("2027-12-01T09:00:00Z"));
    expect(later(importWeb(far.wh, far.entry, "0.1.0", seq)).some((m) => m.includes("1年を超えて"))).toBe(true);
  });

  it("送った日時は受け取りの記録にあり、画面の言葉にできる", async () => {
    const got = await answeredWeb(filled(), {});
    expect(got.entry.received?.submittedAt).toBe("2026-11-06T13:15:00.000Z");
    expect(sentAtText(got.entry.received?.submittedAt ?? "")).toMatch(/11月[67]日/);
    expect(sentAtText("x")).toBe("不明");
  });

  it("元に戻すと、依頼の記録は「取り込み済み」のままだが、世帯の取り込みの記録と照らして「取り込みを元に戻しました」と出す。やり直すと取り込み済みに戻る", async () => {
    const got = await answeredWeb(blank(), { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1985, 6) }, { spouse: 0, child: 0 });
    const before = got.wh;
    const view = importWeb(before, got.entry, "0.1.0", seq);
    const done = markImported(applyImport(before, view, defaultSelection(view), AT_WEB).wh, got.entry.record.requestId, AT_WEB);
    const e = () => webLog(done)[0]!;
    expect(statusOf(e(), NOW, false, done)).toBe("imported");
    // 元に戻す: 世帯は前の状態、依頼の記録は今のもの（keepWebLog）
    const undone = keepWebLog(before, done);
    expect(webLog(undone)[0]?.state).toBe("imported");
    expect(statusOf(webLog(undone)[0]!, NOW, false, undone)).toBe("undone");
    expect(STATUS_TEXT.undone).toContain("元に戻しました");
    // やり直す
    const redone = keepWebLog(done, undone);
    expect(statusOf(webLog(redone)[0]!, NOW, false, redone)).toBe("imported");
  });

  it("取り込んだ親には、画面で足した親と同じく、亡くなる見込みを平均余命の推定（仮の印）で入れる", async () => {
    const got = await answeredWeb(blank(), { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1985, 6), [draftKey("hs.family.parent.alive", 1)]: v("alive"), [draftKey("hs.family.parent.age", 1)]: { status: "value", raw: { kind: "number", text: "70" } } }, { spouse: 0, child: 0 });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const father = view.candidates.find((c) => c.kind === "new" && c.title === "父");
    expect(father?.note).toContain("平均余命の推定");
    const out = applyImport(got.wh, view, defaultSelection(view), AT_WEB).wh;
    const p = out.request.input.household.members.find((m) => m.kind === "parent");
    expect(p?.leaves).not.toBeNull();
    expect(p?.leaves).toBeDefined();
    expect(out.assumed[`family/${p?.id ?? ""}/leaves`]).toContain("平均余命");
  });
});

const AT_WEB = approvalTime(new Date(2026, 10, 7, 10, 0, 0));
