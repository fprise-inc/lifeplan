// 事務所での共有（0023）の画面の側: 指紋の入力・メモの書いた人・分岐の「両方を残す」・開いている人の文と、
// 事務所の共有の設定・世帯の一覧・分岐を選ぶ画面の表示（申請の指紋を承認する人に出さない・パスを出さない・共有オフでは今までどおり）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { ForkInfo, OfficeHost, OfficeStatus, StoredHousehold } from "../src/engine/host.ts";
import { ForkPanel } from "../src/workspace/store/ForkPanel.tsx";
import { HouseholdPanel } from "../src/workspace/store/HouseholdPanel.tsx";
import { memoAuthors, mergeForkBodies, normalizeFingerprint, OFFICE_MESSAGES, presenceText, sinceText, editorsOf, syncShareNotice } from "../src/workspace/store/office.ts";
import { OfficePanel } from "../src/workspace/store/OfficePanel.tsx";
import { MemoDrawer } from "../src/workspace/MemoDrawer.tsx";
import { fromRequest } from "../src/workspace/input/household.ts";
import { modelHousehold } from "./helpers.ts";

const no = async () => Promise.reject("E");
const office: OfficeHost = { status: no, start: no, join: no, cancel: no, approve: no, reject: no, remove: no, moveLocal: no, recover: no, end: no, dismissNotices: no, syncStart: no, syncOpen: no, syncEnd: no, notices: async () => [] };

function status(over: Partial<OfficeStatus> = {}): OfficeStatus {
  return {
    state: "member",
    usage: "office",
    problem: null,
    myName: "担当A",
    myFingerprint: "M3TQ-8VNA-2KXD-H7RP",
    members: [
      { memberId: "a", name: "担当A", fingerprint: "M3TQ-8VNA-2KXD-H7RP", joinedAt: "2026-10-12T00:00:00Z", approvedBy: null, role: "member", isMe: true, viaRecovery: false },
      { memberId: "c", name: "担当C", fingerprint: "Z9KQ-1MNA-7TXD-V4RP", joinedAt: "2026-10-15T00:00:00Z", approvedBy: "担当A", role: "member", isMe: false, viaRecovery: false },
    ],
    removed: [],
    requests: [{ requestId: "r1", name: "担当B", requestedAt: "2026-10-19T00:00:00Z" }],
    officeCode: "7K2M-QX9P",
    syncFolder: true,
    localHouseholds: 0,
    recoveryAcknowledged: false,
    recoveryAcknowledgedBy: null,
    recoveryAcknowledgedAt: null,
    recoveryVerifiedAt: null,
    recoveryRequired: false,
    notices: [],
    ...over,
  };
}

const panel = (st: OfficeStatus | null) => renderToString(h(OfficePanel, { office, status: st, onStatus: () => undefined, onHouseholdsChanged: () => undefined, onRecovery: () => undefined, onClose: () => undefined }));

describe("指紋の入力", () => {
  it("区切り・小文字・全角・紛らわしい文字を吸収し、16文字でなければ受け付けない", () => {
    expect(normalizeFingerprint("7k2m-qx9p-abcd-efgh")).toBe("7K2MQX9PABCDEFGH");
    expect(normalizeFingerprint("７Ｋ２Ｍ ＱＸ９Ｐ ＡＢＣＤ ＥＦＧＨ")).toBe("7K2MQX9PABCDEFGH");
    expect(normalizeFingerprint("O1IL-0000-0000-0000")).toBe("0111000000000000");
    expect(normalizeFingerprint("7K2M-QX9P-ABCD")).toBeNull();
    expect(normalizeFingerprint("7K2M-QX9P-ABCD-EFGU")).toBeNull();
    expect(normalizeFingerprint("")).toBeNull();
  });
});

describe("メモの書いた人", () => {
  it("変わらない行は前の人のまま、新しい行・直した行は今の人", () => {
    const by = memoAuthors(["一行目", "二行目"], ["a", "b"], ["一行目", "二行目を直した", "三行目"], "c");
    expect(by).toEqual(["a", "c", "c"]);
    expect(memoAuthors(["x", "x"], ["a", "b"], ["x"], "c")).toEqual(["a"]);
    // 前の記録が無い行（共有の前に書いた行）は「不明」のまま
    expect(memoAuthors(["古い行"], undefined, ["古い行", "新しい行"], "c")).toEqual([null, "c"]);
    // 行を並べ替えても書いた人は付いてくる
    expect(memoAuthors(["p", "q"], ["a", "b"], ["q", "p"], "c")).toEqual(["b", "a"]);
  });
  it("引き出しの下に、行ごとの書いた人を出す（名簿に無い人は「メンバー」）", () => {
    const wh = { ...fromRequest(modelHousehold("salariedCoupleTwoKids")), memo: ["一行目", "二行目"], memoBy: ["a", "x"] };
    const html = renderToString(h(MemoDrawer, { wh, onEdit: () => undefined, onClose: () => undefined, me: "a", names: { a: "担当A" } }));
    expect(html).toContain("data-memo-authors");
    expect(html).toContain("担当A");
    expect(html).toContain("メンバー");
    // 書いた人の記録が無い世帯（共有していない）は今までどおり
    const plain = renderToString(h(MemoDrawer, { wh: { ...wh, memoBy: undefined }, onEdit: () => undefined, onClose: () => undefined }));
    expect(plain).not.toContain("data-memo-authors");
  });
});

describe("分岐の「両方を残す」", () => {
  it("相手の内容を土台に、こちらにだけあるプランと、同じ ID で中身が違うプランの写しを足す", () => {
    const theirs = JSON.stringify({ household: { memo: ["相手"] }, proposals: [{ id: "p1", title: "プランB", n: 1 }, { id: "p2", title: "プランC", n: 2 }], meta: { savedAt: "x" } });
    const ours = JSON.stringify({ household: { memo: ["こちら"] }, proposals: [{ id: "p1", title: "プランB", n: 1 }, { id: "p2", title: "プランC", n: 9 }, { id: "p3", title: "プランD", n: 3 }] });
    let i = 0;
    const m = mergeForkBodies(theirs, ours, () => `new${++i}`);
    const b = JSON.parse(m.body) as { household: { memo: string[] }; proposals: { id: string; title: string; n: number }[]; meta: unknown };
    expect(m.added).toBe(2);
    expect(b.household.memo).toEqual(["相手"]);
    expect(b.proposals.map((p) => p.id)).toEqual(["p1", "p2", "new1", "p3"]);
    expect(b.proposals[2]).toMatchObject({ title: "プランC（こちらの分岐）", n: 9 });
    expect(b.meta).toEqual({ savedAt: "x" });
    // こちらにだけあるものが無ければ、何も足さない
    expect(mergeForkBodies(theirs, theirs, () => "z").added).toBe(0);
    expect((JSON.parse(m.body) as { snapshots?: unknown }).snapshots).toBeUndefined();
  });

  it("控えは両方の分岐のものを残す（作った後は変えないので、同じ ID は1つ）", () => {
    const theirs = JSON.stringify({ household: {}, proposals: [], snapshots: [{ id: "s1", memo: "相手" }, { id: "s2", memo: "共通" }] });
    const ours = JSON.stringify({ household: {}, proposals: [], snapshots: [{ id: "s2", memo: "共通" }, { id: "s3", memo: "こちら" }] });
    const b = JSON.parse(mergeForkBodies(theirs, ours, () => "z").body) as { snapshots: { id: string }[] };
    expect(b.snapshots.map((x) => x.id)).toEqual(["s1", "s2", "s3"]);
  });
});

describe("開いている人の文", () => {
  it("○○さんが開いています（○分前から）", () => {
    const now = Date.parse("2026-10-19T10:00:00Z");
    expect(sinceText("2026-10-19T09:48:00Z", now)).toBe("12分前から");
    expect(sinceText("2026-10-19T07:30:00Z", now)).toBe("2時間前から");
    expect(sinceText("2026-10-19T10:00:20Z", now)).toBe("今から");
    expect(presenceText([{ name: "担当B", since: "2026-10-19T09:55:00Z" }], now)).toBe("担当Bさんが開いています（5分前から）");
  });
  it("本文の記録からメンバーの表示名を読む", () => {
    expect(editorsOf(JSON.stringify({ meta: { editors: { a: { name: "担当A" }, b: { name: 1 } } } }))).toEqual({ a: "担当A" });
    expect(editorsOf("{}")).toEqual({});
    expect(editorsOf("壊れた")).toEqual({});
  });
});

describe("事務所の共有の設定", () => {
  it("共有オフ: 始める・参加するを出し、表示名が無いと押せない", () => {
    const html = panel(status({ state: "off", members: [], requests: [], myFingerprint: null, officeCode: null, localHouseholds: 3 }));
    expect(html).toContain("data-office-start");
    expect(html).toContain("data-office-join");
    expect(html).toMatch(/data-office-start[^>]*disabled|disabled[^>]*data-office-start/);
    expect(html).toContain("顧客のお名前は入れないでください");
    expect(html).toContain("このPCの世帯（3件）");
  });
  it("承認待ち: 自分の指紋を大きく出し、別の方法で伝えるよう案内する", () => {
    const html = panel(status({ state: "pending", members: [], requests: [], officeCode: null, myFingerprint: "R8DW-5N2K-QH7T-3MVA" }));
    expect(html).toContain("R8DW-5N2K-QH7T-3MVA");
    expect(html).toContain("ファイルとは別の方法で");
  });
  it("メンバー: 申請の指紋は出さず、入力するまで承認できない。メンバーの指紋・参加日・承認した人を出す", () => {
    const html = panel(status());
    expect(html).toContain('data-office-request="担当B"');
    expect(html).toMatch(/data-office-approve[^>]*disabled|disabled[^>]*data-office-approve/);
    expect(html).toContain("Z9KQ-1MNA-7TXD-V4RP");
    expect(html).toContain("2026/10/15");
    expect(html).toContain("（始めた人）");
    expect(html).toContain("7K2M-QX9P");
    // 自分は外せない
    expect(html).toContain('data-office-remove="担当C"');
    expect(html).not.toContain('data-office-remove="担当A"');
    // パスらしいものは出さない
    expect(html).not.toMatch(/\/Users\/|Library\/|lifeplan-office|:\\\\/);
  });
  it("事務所の復元キーを保管するまで、承認・外すを止め、理由と保管への導線を出す", () => {
    const html = panel(status({ recoveryRequired: true }));
    expect(html).toContain("data-office-locked");
    expect(html).toContain("data-office-locked-go");
    expect(html).toContain("世帯を開く・直すことはできます");
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-office-remove="担当C"/);
    expect(html).toMatch(/data-office-approve[^>]*disabled|disabled[^>]*data-office-approve/);
    // 外した後（外したメンバーがいる）は、新しいキーを保管するよう案内する
    expect(panel(status({ recoveryRequired: true, removed: [{ name: "担当X", removedAt: "2026-10-19T00:00:00Z", removedBy: "担当A" }] }))).toContain("事務所の復元キーは新しくなります");
    const ok = panel(status({ recoveryRequired: false, recoveryAcknowledged: true, recoveryAcknowledgedBy: "担当A", recoveryAcknowledgedAt: "2026-10-19T00:00:00Z" }));
    expect(ok).not.toContain("data-office-locked");
    expect(ok).not.toMatch(/<button[^>]*disabled[^>]*data-office-remove="担当C"/);
  });
  it("復元キーで加わった人を、名簿と通知に出す", () => {
    const st = status({
      members: [...status().members, { memberId: "n", name: "担当N", fingerprint: "N4KD-7QXA-2MVT-H9RP", joinedAt: "2026-10-19T00:00:00Z", approvedBy: null, role: "member", isMe: false, viaRecovery: true }],
      notices: [{ kind: "recoveryJoin", name: "担当N", at: "2026-10-19T00:00:00Z" }],
    });
    const html = panel(st);
    expect(html).toContain("data-office-notice");
    expect(html).toContain("復元キーで担当Nさんが加わりました");
    expect(html).toContain("（復元キーで参加）");
    expect(panel(status())).not.toContain("data-office-notice");
  });
  it("共有オフ: 事務所の復元キーで加わる入口を出す（表示名と復元キーが無いと押せない）", () => {
    const html = panel(status({ state: "off", members: [], requests: [], myFingerprint: null, officeCode: null }));
    expect(html).toContain("data-office-recover-section");
    expect(html).toMatch(/data-office-recover(?!-)[^>]*disabled|disabled[^>]*data-office-recover(?!-)/);
    expect(html).toContain("ほかのメンバーの画面にも「復元キーで○○さんが加わりました」と出ます");
  });
  it("共有をやめる: 最後の1人だけ。ほかのメンバーがいる間は理由と抜け方を出す", () => {
    const many = panel(status());
    expect(many).toContain("data-office-end-blocked");
    expect(many).not.toContain("data-office-end>");
    expect(many).toContain("外してもらって");
    const one = panel(status({ members: [status().members[0]!], requests: [] }));
    expect(one).toContain("data-office-end");
    expect(one).not.toContain("data-office-end-blocked");
  });
  it("外す画面の案内: 同期サービス側の共有からも外す", () => {
    expect(syncShareNotice("担当C")).toBe("共有フォルダの共有の設定（同期サービス側）からも、担当Cさんを外してください");
  });
  it("共有を終えた事務所では、このPCの中の事務所に戻る道を出す", () => {
    const html = panel(status({ state: "unavailable", problem: "E_OFFICE_CLOSED", members: [], requests: [] }));
    expect(html).toContain("この事務所の共有は終わっています");
    expect(html).toContain("このPCの中の事務所に戻る");
  });
  it("文言に以前の呼び方（案）が無い", () => {
    for (const t of Object.values(OFFICE_MESSAGES)) expect(t.replace(/提案|案内/g, "").includes("案"), t).toBe(false);
  });
});

describe("世帯の一覧", () => {
  const list: StoredHousehold[] = [
    { id: "1", customerNo: "A0001", summary: "本人・配偶者", createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T01:00:00Z", updatedBy: "担当B", openBy: [{ name: "担当B", since: new Date(Date.now() - 12 * 60_000).toISOString() }], forks: 1 },
    { id: "2", customerNo: "A0002", summary: "本人", createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:30:00Z", updatedBy: null, openBy: [], forks: 0 },
  ];
  const base = { status: { state: "ready" as const, firstRun: false, recoveryAcknowledged: true, recoveryVerifiedAt: null, lastOpened: null, deletionsPending: 0, deletionsCompleted: 0 }, unavailable: null, error: null, list, currentId: null, categories: [{ code: "A", name: "顧問契約" }, { code: "B", name: "単発相談" }, { code: "C", name: "見込み客" }], shelf: [], currentSample: null, currentShape: null, unsavedTitle: null, onOpen: () => undefined, onCreate: () => undefined, onSaveCurrent: () => undefined, onRename: async () => null, onSetCategory: async () => null, onAssignSerial: async () => null, onMakeSample: async () => null, onSaveCategories: async () => null, onOpenSample: () => undefined, onCustomerFromSample: () => undefined, onCopySample: () => undefined, onUpdateSample: async () => null, onDelete: async () => null, onRecovery: () => undefined, onClose: () => undefined };
  it("共有しているときは、最後に直した人と開いている人・同期の衝突の写しを出す", () => {
    const html = renderToString(h(HouseholdPanel, { ...base, officeState: "member", onOffice: () => undefined }));
    expect(html).toContain("最後に直した人");
    expect(html).toContain("担当Bさん（12分前から）");
    expect(html).toContain('data-household-forks="1"');
    expect(html).toContain("事務所の共有フォルダに自動で保存します");
  });
  it("共有オフでは今までどおり（列を足さない）", () => {
    const html = renderToString(h(HouseholdPanel, { ...base, list: list.map((x) => ({ ...x, updatedBy: null, openBy: [], forks: 0 })), officeState: "off", onOffice: () => undefined }));
    expect(html).not.toContain("最後に直した人");
    expect(html).not.toContain("開いている人");
    expect(html).toContain("このPCのアプリのデータの場所に自動で保存します");
    expect(html).toContain("オフ（既定）");
  });
});

describe("分岐を選ぶ画面", () => {
  const info: ForkInfo = { savedConflict: true, theirsSavedAt: "2026-10-19T01:00:00Z", theirsBy: "担当B", theirsGeneration: 5, oursGeneration: 5, syncCopies: 0, personal: false };
  it("相手の名前と、3つの選び方を出す", () => {
    const html = renderToString(h(ForkPanel, { customerNo: "A0001", info, busy: false, error: null, onChoose: () => undefined, onSyncCopies: () => undefined, onClose: () => undefined }));
    expect(html).toContain("担当Bさん");
    for (const c of ["theirs", "both", "ours"]) expect(html).toContain(`data-fork-choice="${c}"`);
    expect(html).toContain("選ばなかったほうはこのPCの中に暗号化したまま残ります");
    expect(html).not.toContain("data-fork-sync");
  });
  it("同期サービスの衝突の写しだけのときは、写しの扱いだけを出す", () => {
    const html = renderToString(h(ForkPanel, { customerNo: "A0001", info: { ...info, savedConflict: false, syncCopies: 2 }, busy: false, error: null, onChoose: () => undefined, onSyncCopies: () => undefined, onClose: () => undefined }));
    expect(html).toContain('data-fork-sync="adopt"');
    expect(html).not.toContain("data-fork-choice");
  });
});
