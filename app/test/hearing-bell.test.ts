// Web のヒアリングの届いた知らせを上の帯のベルにも出す（0192 の追記 2026-11-18）: 開いていない世帯も、本体に開かずに読んでもらった依頼の欄で確かめる。
// 一覧の更新日時が変わった世帯だけを読み直す・開いている世帯は飛ばす・受け取ったら消える・新しい書類はまた未読・取り消し・消した世帯は忘れる
import { describe, expect, it } from "vitest";
import { handleApi } from "../../hearing/relay/handler.ts";
import { memoryStore } from "../../hearing/relay/store.ts";
import { answersOf, draftKey, initialDraft, openRequest, sendDocuments, submitAnswers, unsentFiles, uploadFile, type RelayTransport } from "../../hearing/src/web/index.ts";
import { API_PREFIX } from "../../hearing/src/web/protocol.ts";
import { askFocus, checkUnopened, hearingBellItems, householdLabel, peekedLive, readPeeks, takeFocus, wantedFocus, type HearingPeek, type PeekCache } from "../src/workspace/hearing/bell.ts";
import { arrivalOf, checkArrivals, documentFromTemplate, issueWeb, noteArrival, officeFace, receiveWeb, templateSelection, webLog, withWebEntry } from "../src/workspace/hearing/web.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import type { StoredHousehold } from "../src/engine/host.ts";

const OFFICE = officeFace({ name: "【架空】みらいFP事務所", color: "#2f6f5e", purpose: "ライフプランの作成のため", privacyContact: "" });
const NOW = new Date("2026-11-18T09:00:00Z");
let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const blank = (): WorkingHousehold => withRefreshedEstimates(blankHousehold("2026-11", seq));
const v = (text: string) => ({ status: "value" as const, raw: { kind: "text" as const, text } });
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 2000 }, (_, i) => i % 200)]) as Uint8Array<ArrayBuffer>;

function relayFor() {
  const store = memoryStore();
  const t: RelayTransport = async (r) => {
    const headers: Record<string, string> = {};
    if (r.token !== undefined) headers.authorization = `Bearer ${r.token}`;
    const res = await handleApi(new Request(`https://relay.test${API_PREFIX}${r.path}`, { method: r.method, headers, ...(r.body !== undefined ? { body: r.body } : {}) }), { store, now: () => NOW });
    return { status: res.status, body: await res.text() };
  };
  return t;
}

/** 本体の store_peek_hearing と同じ欄を、世帯の中身から作る（本体の試験は crates/household-store の tests/store.rs） */
const peekOf = (wh: WorkingHousehold): unknown =>
  webLog(wh)
    .filter((e) => e.state !== "cancelled" && e.closedAt === undefined)
    .map((e) => ({ requestId: e.record.requestId, serverId: e.record.serverId, pickupToken: e.record.secrets.pickupToken, expiresAt: e.record.expiresAt, state: e.state, received: e.received !== undefined, batchIds: (e.batches ?? []).map((b) => b.batchId) }));

const row = (id: string, updatedAt: string, summary = "本人・配偶者｜回答が届いています"): StoredHousehold => ({ id, customerNo: `A${id.slice(-4)}`, summary, createdAt: NOW.toISOString(), updatedAt, updatedBy: null, openBy: [], forks: 0 });

/** 保存した世帯（内部ID → 中身）と、本体に読んでもらった回数 */
function shelf() {
  const files = new Map<string, WorkingHousehold>();
  const reads: string[] = [];
  return {
    files,
    reads,
    peek: async (id: string) => {
      reads.push(id);
      const wh = files.get(id);
      if (wh === undefined) throw new Error("E_STORE_UNKNOWN_HOUSEHOLD");
      return peekOf(wh);
    },
  };
}

async function issue(t: RelayTransport, withDoc = false) {
  const wh = blank();
  const s0 = templateSelection("simple", wh);
  const sel = withDoc ? { ...s0, documents: [documentFromTemplate(s0, "withholding", "self")] } : s0;
  return issueWeb(wh, { selection: sel, customerNo: "A0001", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
}

async function answer(t: RelayTransport, url: string) {
  const o = await openRequest(new URL(url).hash, t);
  await submitAnswers(o, answersOf(o.packet, { ...initialDraft(o.packet), gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.consent.purpose")]: v("given") } }, NOW), t);
  return o;
}

const live = (cache: PeekCache) => (hh: string, rid: string) => peekedLive(cache, hh, rid, NOW);

describe("本体の返した依頼の欄を読む", () => {
  it("形の合わない1件・取り消しは捨てる。答え・書類の中身は持たない", () => {
    const ok = { requestId: "W-1", serverId: "s", pickupToken: "p", expiresAt: "2026-12-01T00:00:00Z", state: "issued", received: false, batchIds: ["b1", 3] };
    expect(readPeeks([ok, { ...ok, requestId: "" }, { ...ok, state: "cancelled" }, null, "x"])).toEqual<HearingPeek[]>([{ ...ok, batchIds: ["b1"] }]);
    expect(readPeeks({})).toEqual([]);
  });
});

describe("開いていない世帯の届いた知らせ（ベル）", () => {
  it("回答が届くとベルに1件（題・世帯の番号と構成・依頼番号）。一覧の更新日時が同じ世帯は読み直さない", async () => {
    const t = relayFor();
    const r = await issue(t);
    const sh = shelf();
    const id = "11111111-0000-4000-8000-000000000001";
    sh.files.set(id, r.wh);
    const cache: PeekCache = new Map();
    const list = [row(id, "2026-11-18T08:00:00Z")];
    await checkUnopened({ list, current: null, peek: sh.peek, call: t, cache, now: NOW });
    expect(arrivalOf(r.entry.record.requestId)).toMatchObject({ answers: false, household: id });
    expect(hearingBellItems(list, live(cache))).toEqual([]);
    await answer(t, r.entry.record.url);
    await checkUnopened({ list, current: null, peek: sh.peek, call: t, cache, now: NOW });
    expect(sh.reads).toEqual([id]);
    const items = hearingBellItems(list, live(cache));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ householdId: id, requestId: r.entry.record.requestId, title: "事前ヒアリングの回答が届きました", household: "A0001（本人・配偶者）" });
    expect(items[0]!.body).toBe(`世帯 A0001（本人・配偶者）の依頼 ${r.entry.record.requestId} に、お客さまの回答が届いています。「受け取る」を押すと世帯ファイルに入り、そのまま取り込みの候補の画面に進みます。`);
    expect(items[0]!.key).toBe(`household:${id}:hearing:${r.entry.record.requestId}:answers:0`);
  });

  it("開いている世帯は飛ばす（開いている世帯は世帯の中身で確かめる）。読めない世帯は依頼なしとして覚える", async () => {
    const t = relayFor();
    const sh = shelf();
    const open = "11111111-0000-4000-8000-000000000002";
    const broken = "11111111-0000-4000-8000-000000000003";
    const cache: PeekCache = new Map();
    await checkUnopened({ list: [row(open, "a"), row(broken, "a")], current: open, peek: sh.peek, call: t, cache, now: NOW });
    expect(sh.reads).toEqual([broken]);
    expect(cache.get(broken)).toEqual({ updatedAt: "a", peeks: [] });
    expect(cache.has(open)).toBe(false);
    // 開いている世帯の確かめ（App.tsx）も世帯の内部ID を覚え、ベルに出る
    const r = await issue(t);
    await answer(t, r.entry.record.url);
    await checkArrivals(r.wh, t, NOW, open);
    const items = hearingBellItems([row(open, "a", "本人")], (hh, rid) => hh === open && webLog(r.wh).some((e) => e.record.requestId === rid));
    expect(items.map((i) => [i.householdId, i.household])).toEqual([[open, "A0002（本人）"]]);
    // 世帯を書かない確かめ（依頼の一覧の「届いたかを確かめる」）でも、世帯は前の結果のまま
    noteArrival(r.entry.record.requestId, { answers: true, batches: 0, submitted: true, at: NOW.toISOString() });
    expect(arrivalOf(r.entry.record.requestId)?.household).toBe(open);
  });

  it("受け取ると（保存して一覧の更新日時が変わると）ベルから消える。後から書類が届けば「書類が届きました」で、また未読", async () => {
    const t = relayFor();
    const r = await issue(t, true);
    const sh = shelf();
    const id = "11111111-0000-4000-8000-000000000004";
    sh.files.set(id, r.wh);
    const cache: PeekCache = new Map();
    const o = await answer(t, r.entry.record.url);
    await checkUnopened({ list: [row(id, "1")], current: null, peek: sh.peek, call: t, cache, now: NOW });
    expect(hearingBellItems([row(id, "1")], live(cache))).toHaveLength(1);
    // 別の PC（またはこの世帯を開いた後）で受け取って保存した
    const got = (await receiveWeb(r.wh, r.entry, t, NOW))!;
    sh.files.set(id, got.wh);
    await checkUnopened({ list: [row(id, "2")], current: null, peek: sh.peek, call: t, cache, now: NOW });
    expect(sh.reads).toEqual([id, id]);
    expect(hearingBellItems([row(id, "2")], live(cache))).toEqual([]);
    // 書類待ちの書類が届いた
    const up = await uploadFile(o, jpeg, t);
    await sendDocuments(o, unsentFiles({ documents: { d1: { status: "attached", files: [{ fileId: up.fileId, mime: "image/jpeg", bytes: jpeg.length, sha256: up.sha256, label: "写真 1" }] } } }), t);
    await checkUnopened({ list: [row(id, "2")], current: null, peek: sh.peek, call: t, cache, now: NOW });
    const items = hearingBellItems([row(id, "2")], live(cache));
    expect(items.map((i) => i.title)).toEqual(["事前ヒアリングの書類が届きました"]);
    expect(items[0]!.body).toContain("待っていた書類（1回分）が届いています");
    expect(items[0]!.key).toBe(`household:${id}:hearing:${r.entry.record.requestId}:documents:1`);
  });

  it("取り消した依頼・一覧から消えた世帯は忘れる。期限の過ぎた依頼はサーバーに聞かない", async () => {
    const t = relayFor();
    const r = await issue(t);
    const sh = shelf();
    const id = "11111111-0000-4000-8000-000000000005";
    sh.files.set(id, r.wh);
    const cache: PeekCache = new Map();
    await answer(t, r.entry.record.url);
    await checkUnopened({ list: [row(id, "1")], current: null, peek: sh.peek, call: t, cache, now: NOW });
    expect(arrivalOf(r.entry.record.requestId)?.answers).toBe(true);
    sh.files.set(id, withWebEntry(r.wh, { ...r.entry, state: "cancelled" }));
    await checkUnopened({ list: [row(id, "2")], current: null, peek: sh.peek, call: t, cache, now: NOW });
    expect(arrivalOf(r.entry.record.requestId)).toBeUndefined();
    // 一覧から消えた世帯
    sh.files.set(id, r.wh);
    await checkUnopened({ list: [row(id, "3")], current: null, peek: sh.peek, call: t, cache, now: NOW });
    expect(arrivalOf(r.entry.record.requestId)).toBeDefined();
    await checkUnopened({ list: [], current: null, peek: sh.peek, call: t, cache, now: NOW });
    expect(arrivalOf(r.entry.record.requestId)).toBeUndefined();
    expect(cache.size).toBe(0);
    // 期限の過ぎた依頼
    let calls = 0;
    const counting: RelayTransport = async (q) => (calls++, t(q));
    const later = new Date(Date.parse(r.entry.record.expiresAt) + 1000);
    await checkUnopened({ list: [row(id, "4")], current: null, peek: sh.peek, call: counting, cache, now: later });
    expect(calls).toBe(0);
    expect(peekedLive(cache, id, r.entry.record.requestId, later)).toBe(false);
  });

  it("世帯の見せ方は顧客番号と構成の要約（印は外す）。一覧に無い世帯・受け付けていない依頼はベルに出さない", () => {
    expect(householdLabel({ customerNo: "C0003", summary: "本人・配偶者・子1人｜取り込み待ち" })).toBe("C0003（本人・配偶者・子1人）");
    expect(householdLabel({ customerNo: "C0003", summary: "" })).toBe("C0003");
    noteArrival("W-ZZZZ-0001", { answers: true, batches: 0, submitted: true, at: NOW.toISOString(), household: "nowhere" });
    expect(hearingBellItems([], () => true).some((i) => i.requestId === "W-ZZZZ-0001")).toBe(false);
    noteArrival("W-ZZZZ-0002", { answers: true, batches: 0, submitted: true, at: NOW.toISOString(), household: "hh-x" });
    expect(hearingBellItems([row("hh-x", "1")], () => false).some((i) => i.requestId === "W-ZZZZ-0002")).toBe(false);
    expect(hearingBellItems([row("hh-x", "1")], () => true).some((i) => i.requestId === "W-ZZZZ-0002")).toBe(true);
  });

  it("ベルから「受け取る」へ: 移ってほしい依頼を覚え、依頼の一覧がその行を出したら受け取る", () => {
    askFocus("W-ABCD");
    expect(wantedFocus()).toBe("W-ABCD");
    takeFocus("W-OTHER");
    expect(wantedFocus()).toBe("W-ABCD");
    takeFocus("W-ABCD");
    expect(wantedFocus()).toBeNull();
  });
});
