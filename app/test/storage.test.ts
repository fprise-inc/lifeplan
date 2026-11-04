// 1人で2台の PC の同期フォルダ（0024）の画面の側: 保存先のパネル（このPCの中・同期フォルダ・2台目の PC で開く・PC の一覧・外す・戻す）、
// 世帯の一覧の PC の言葉と通知、事務所の共有のパネルとの出し分け、初回の案内の「2台目の PC」の入口、分岐の画面、通知の文
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { ForkInfo, OfficeHost, OfficeStatus, StorageNotice, StoredHousehold, StoreHost, StoreStatus } from "../src/engine/host.ts";
import { ForkPanel } from "../src/workspace/store/ForkPanel.tsx";
import { HouseholdPanel } from "../src/workspace/store/HouseholdPanel.tsx";
import { presenceText } from "../src/workspace/store/office.ts";
import { OfficePanel } from "../src/workspace/store/OfficePanel.tsx";
import { RecoveryPanel } from "../src/workspace/store/RecoveryPanel.tsx";
import { StoragePanel } from "../src/workspace/store/StoragePanel.tsx";
import { storageNoticeText, SYNC_MESSAGES, syncMessage } from "../src/workspace/store/storage.ts";

const no = async () => Promise.reject("E");
const office: OfficeHost = { status: no, start: no, join: no, cancel: no, approve: no, reject: no, remove: no, moveLocal: no, recover: no, end: no, dismissNotices: no, defaults: async () => ({}), putDefaults: no, featureStatus: async () => ({ today: "2026-11-01", active: [], codes: [], invalid: [] }), addFeatureCode: no, removeFeatureCode: no, dismissFeatureNotice: no, checkFeatureCodes: no, decideFeatureCandidate: no, syncStart: no, syncOpen: no, syncEnd: no, notices: async () => [] };
const store: StoreHost = { status: no, list: no, create: no, open: no, save: no, rename: no, remove: no, recoveryKey: no, acknowledgeRecovery: no, testRecoveryKey: no, restoreWithRecoveryKey: no, closeReady: async () => undefined, closeCancel: async () => undefined, forkInfo: no, resolveFork: no, resolveSyncCopies: no, leave: async () => undefined, devFileKeys: async () => false, listSamples: no, setCategory: no, assignSerial: no, makeSample: no, updateSample: no, categories: no, setCategories: no };

const ready = (over: Partial<StoreStatus> = {}): StoreStatus => ({ state: "ready", firstRun: false, recoveryAcknowledged: true, recoveryVerifiedAt: null, lastOpened: null, deletionsPending: 0, deletionsCompleted: 0, ...over });

function personal(over: Partial<OfficeStatus> = {}): OfficeStatus {
  return {
    state: "member",
    usage: "personal",
    problem: null,
    myName: "事務所のPC",
    myFingerprint: "M3TQ-8VNA-2KXD-H7RP",
    members: [
      { memberId: "a", name: "事務所のPC", fingerprint: "M3TQ-8VNA-2KXD-H7RP", joinedAt: "2026-10-12T00:00:00Z", approvedBy: null, role: "member", isMe: true, viaRecovery: false },
      { memberId: "b", name: "自宅のノート", fingerprint: "Z9KQ-1MNA-7TXD-V4RP", joinedAt: "2026-10-15T00:00:00Z", approvedBy: null, role: "member", isMe: false, viaRecovery: true },
    ],
    removed: [],
    requests: [],
    officeCode: "7K2M-QX9P",
    syncFolder: true,
    localHouseholds: 0,
    recoveryAcknowledged: true,
    recoveryAcknowledgedBy: "事務所のPC",
    recoveryAcknowledgedAt: "2026-10-12T00:00:00Z",
    recoveryVerifiedAt: null,
    recoveryRequired: false,
    notices: [],
    viewOnly: false,
    ...over,
  };
}

const off = (over: Partial<OfficeStatus> = {}) => personal({ state: "off", usage: null, members: [], myName: null, myFingerprint: null, officeCode: null, localHouseholds: 3, recoveryAcknowledged: false, recoveryAcknowledgedBy: null, recoveryAcknowledgedAt: null, ...over });

const storage = (st: OfficeStatus | null, ss: StoreStatus = ready(), extra: { focus?: "open" | null; notices?: StorageNotice[] } = {}) =>
  renderToString(h(StoragePanel, { office, status: st, storeStatus: ss, notices: extra.notices ?? [], focus: extra.focus ?? null, onStatus: () => undefined, onHouseholdsChanged: () => undefined, onRecovery: () => undefined, onOffice: () => undefined, onClose: () => undefined }));

const notice = (kind: string, over: Partial<StorageNotice> = {}): StorageNotice => ({ kind, level: "warn", scope: "personal", count: null, name: null, at: null, code: null, ...over });

describe("保存先のパネル: このPCの中（既定）", () => {
  it("同期フォルダへ移す・2台目の PC で開くを出し、呼び名が無いと押せない", () => {
    const html = storage(off());
    expect(html).toContain('data-storage-panel="local"');
    expect(html).toContain("このPCの中</b>（既定）");
    expect(html).toContain("data-sync-start");
    expect(html).toContain("data-sync-open");
    expect(html).toMatch(/data-sync-start[^>]*disabled|disabled[^>]*data-sync-start/);
    expect(html).toMatch(/data-sync-open[^>]*disabled|disabled[^>]*data-sync-open/);
    expect(html).toContain("このPCの世帯（3件）");
    expect(html).toContain("顧客のお名前は入れないでください");
    // 説明: 暗号化のまま・版の履歴・同時に直したときの分岐・バックアップは各 PC の中・複数の FP は事務所の共有
    expect(html).toContain("暗号化したまま");
    expect(html).toContain("版の履歴には、暗号化された古い写しが残ります");
    expect(html).toContain("分岐");
    expect(html).toContain("毎日の自動バックアップは、それぞれのPCの中");
    expect(html).toContain("data-sync-to-office");
  });
  it("復元キーを保管していなければ、先に保管を求める（移すボタンは押せない）", () => {
    const html = storage(off(), ready({ recoveryAcknowledged: false }));
    expect(html).toContain("data-sync-needs-recovery");
    expect(html).toContain("先に復元キーを保管してください");
    expect(storage(off(), ready({ recoveryAcknowledged: true }))).not.toContain("data-sync-needs-recovery");
    // 「試して確かめた」だけでも保管済みとみなす
    expect(storage(off(), ready({ recoveryAcknowledged: false, recoveryVerifiedAt: "2026-10-19T00:00:00Z" }))).not.toContain("data-sync-needs-recovery");
  });
  it("初回の案内から来たときは、2台目の PC として開く節を先に出す", () => {
    const html = storage(off(), ready(), { focus: "open" });
    expect(html.indexOf("data-sync-open-section")).toBeLessThan(html.indexOf("data-sync-start-section"));
    const normal = storage(off());
    expect(normal.indexOf("data-sync-start-section")).toBeLessThan(normal.indexOf("data-sync-open-section"));
  });
});

describe("保存先のパネル: 同期フォルダ（1人で2台の PC）", () => {
  it("PC の一覧（このPC・復元キーで開いた PC）を出し、人の言葉・指紋・承認は出さない", () => {
    const html = storage(personal());
    expect(html).toContain('data-storage-panel="sync-member"');
    expect(html).toContain("同期フォルダ</b>");
    expect(html).toContain('data-sync-pc="事務所のPC"');
    expect(html).toContain('data-sync-pc="自宅のノート"');
    expect(html).toContain("このPC");
    expect(html).toContain("復元キーで開いた");
    expect(html).toContain('data-sync-remove="自宅のノート"');
    expect(html).not.toContain('data-sync-remove="事務所のPC"');
    expect(html).not.toContain("M3TQ-8VNA");
    expect(html).not.toContain("指紋");
    expect(html).not.toContain("承認する");
    expect(html).not.toContain("さん");
    expect(html).toContain("data-sync-end");
    expect(html).toContain("同期フォルダには置きません");
  });
  it("復元キーで PC が加わった通知・置かれた参加の申請（承認はできない）・移していない世帯", () => {
    const html = storage(personal({ notices: [{ kind: "recoveryJoin", name: "古いノート", at: "2026-10-19T00:00:00Z" }], requests: [{ requestId: "r", name: "だれか", requestedAt: "2026-10-19T00:00:00Z" }], localHouseholds: 2 }));
    expect(html).toContain("data-sync-notice");
    expect(html).toContain("復元キーで「古いノート」が同期フォルダを開きました");
    expect(html).toContain("data-sync-requests");
    expect(html).toContain("承認はできません");
    expect(html).not.toContain("data-office-approve");
    expect(html).toContain("data-sync-move");
    expect(html).toContain("2件");
  });
  it("PC を外して復元キーが新しくなったら、保管するまで次に外す操作を止める", () => {
    const html = storage(personal({ recoveryRequired: true, recoveryAcknowledged: false }));
    expect(html).toContain("data-sync-locked");
    expect(html).toMatch(/data-sync-remove="自宅のノート"[^>]*disabled|disabled[^>]*data-sync-remove="自宅のノート"/);
  });
  it("終わった同期フォルダ・使えないとき・外されたときは、このPCの中に戻る道を出す", () => {
    const closed = storage(personal({ state: "unavailable", problem: "E_OFFICE_CLOSED" }));
    expect(closed).toContain(SYNC_MESSAGES.E_OFFICE_CLOSED as string);
    expect(closed).toContain("data-sync-back-local");
    const missing = storage(personal({ state: "unavailable", problem: "E_OFFICE_UNAVAILABLE" }));
    expect(missing).toContain("同期フォルダが見つかりません");
    expect(missing).not.toContain("data-sync-back-local");
    const removed = storage(personal({ state: "removed" }));
    expect(removed).toContain("同期フォルダから外されました");
    expect(removed).toContain("data-sync-back-local");
  });
  it("事務所の共有（複数の FP）で使っているときは、事務所の共有のパネルへ案内する", () => {
    const html = storage(personal({ usage: "office" }));
    expect(html).toContain('data-storage-panel="office"');
    expect(html).toContain("data-storage-office");
    expect(html).not.toContain("data-sync-pc");
  });
});

describe("世帯の一覧", () => {
  const list: StoredHousehold[] = [{ id: "1", customerNo: "A0001", summary: "本人", createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T01:00:00Z", updatedBy: "自宅のノート", openBy: [{ name: "自宅のノート", since: new Date(Date.now() - 3 * 60_000).toISOString() }], forks: 0 }];
  const base = { status: ready(), unavailable: null, error: null, list, currentId: null, categories: [{ code: "A", name: "顧問契約" }, { code: "B", name: "単発相談" }, { code: "C", name: "見込み客" }], shelf: [], currentSample: null, currentShape: null, unsavedTitle: null, onOpen: () => undefined, onCreate: () => undefined, onSaveCurrent: () => undefined, onRename: async () => null, onSetCategory: async () => null, onAssignSerial: async () => null, onMakeSample: async () => null, onSaveCategories: async () => null, onOpenSample: () => undefined, onCustomerFromSample: () => undefined, onCopySample: () => undefined, onUpdateSample: async () => null, onDelete: async () => null, onRecovery: () => undefined, onClose: () => undefined, onOffice: () => undefined, onStorage: () => undefined };
  it("同期フォルダのときは PC の言葉で出し、保存先は「同期フォルダ」", () => {
    const html = renderToString(h(HouseholdPanel, { ...base, officeState: "member", usage: "personal" as const, storageNotices: [notice("syncCopies", { count: 1 })] }));
    expect(html).toContain("同期フォルダに自動で保存します（2台のPCで使えます）");
    expect(html).toContain("最後に直したPC");
    expect(html).toContain("開いているPC");
    expect(html).toContain("「自宅のノート」（3分前から）");
    expect(html).not.toContain("さん（");
    expect(html).toContain("同期フォルダ（2台のPC）");
    expect(html).toContain("オフ（同期フォルダで1人で使っています）");
    expect(html).toContain("data-household-notices");
    expect(html).toContain("同期サービスの衝突の写しがある世帯が1件あります");
  });
  it("このPCの中のときは「このPCの中」。PC の中だけの復元キーの通知は帯の案内に任せて出さない", () => {
    const html = renderToString(h(HouseholdPanel, { ...base, list: [], officeState: "off", usage: null, storageNotices: [notice("recoveryNotKept", { scope: "local", level: "info" })] }));
    expect(html).toMatch(/data-storage-label[^>]*>このPCの中</);
    expect(html).not.toContain("data-household-notices");
  });
});

describe("事務所の共有のパネルとの出し分け", () => {
  const panel = (st: OfficeStatus) => renderToString(h(OfficePanel, { office, status: st, onStatus: () => undefined, onHouseholdsChanged: () => undefined, onRecovery: () => undefined, onStorage: () => undefined, onClose: () => undefined }));
  it("同期フォルダで使っている間は、事務所の共有の操作を出さず保存先へ案内する", () => {
    const html = panel(personal());
    expect(html).toContain("data-office-personal");
    expect(html).toContain("data-office-to-storage");
    expect(html).not.toContain("data-office-member");
    expect(html).not.toContain("指紋");
    expect(html).not.toContain("data-office-end");
  });
  it("事務所の共有がオフのときは、1人で2台なら保存先から、と案内する", () => {
    const html = panel(off());
    expect(html).toContain("data-office-storage-hint");
    expect(html).toContain("data-office-start");
  });
});

describe("初回の案内（復元キー）", () => {
  const rk = (props: Record<string, unknown>) => renderToString(h(RecoveryPanel, { mode: "first", store, status: ready({ firstRun: true, recoveryAcknowledged: false }), onStatus: () => undefined, onClose: () => undefined, ...props }));
  it("2台目の PC なら、すでに使っている同期フォルダを開く入口を出す", () => {
    const html = rk({ onOpenSync: () => undefined });
    expect(html).toContain("data-recovery-second-pc");
    expect(html).toContain("すでに使っている同期フォルダを開く");
    expect(rk({})).not.toContain("data-recovery-second-pc");
    // 共有・同期フォルダで使っているときは出さない
    expect(rk({ onOpenSync: () => undefined, shared: true })).not.toContain("data-recovery-second-pc");
  });
  it("同期フォルダの復元キーは、どの PC でも同じと説明する", () => {
    const html = renderToString(h(RecoveryPanel, { mode: "manage", store, status: ready(), onStatus: () => undefined, onClose: () => undefined, shared: true, personal: true }));
    expect(html).toContain("復元キー（同期フォルダ）");
    expect(html).toContain("どのPCでも同じ復元キーです");
    expect(html).not.toContain("事務所の代表");
  });
  it("PC の中だけのときは、保存先と事務所の共有の違いを書く", () => {
    const html = renderToString(h(RecoveryPanel, { mode: "manage", store, status: ready(), onStatus: () => undefined, onClose: () => undefined, onStorage: () => undefined }));
    expect(html).toContain("1人で2台のPCで使うときは");
    expect(html).toContain("data-recovery-to-storage");
  });
});

describe("分岐・開いている PC の文", () => {
  it("相手はもう1台の PC", () => {
    const info: ForkInfo = { savedConflict: true, theirsSavedAt: "2026-10-19T01:00:00Z", theirsBy: "自宅のノート", theirsGeneration: 5, oursGeneration: 5, syncCopies: 0, personal: true };
    const html = renderToString(h(ForkPanel, { customerNo: "A0001", info, busy: false, error: null, onChoose: () => undefined, onSyncCopies: () => undefined, onClose: () => undefined }));
    expect(html).toContain("もう1台のPC「自宅のノート」");
    expect(html).not.toContain("自宅のノートさん");
  });
  it("開いている PC の文", () => {
    const now = Date.parse("2026-10-19T01:10:00Z");
    expect(presenceText([{ name: "自宅のノート", since: "2026-10-19T01:00:00Z" }], now, true)).toBe("もう1台のPC「自宅のノート」で開いています（10分前から）");
    expect(presenceText([{ name: "担当B", since: "2026-10-19T01:00:00Z" }], now)).toBe("担当Bさんが開いています（10分前から）");
  });
});

describe("通知の文", () => {
  it("種類ごとに、保存先に合った文を作る", () => {
    expect(storageNoticeText(notice("recoveryJoin", { name: "古いノート" }))).toContain("「古いノート」が同期フォルダを開きました");
    expect(storageNoticeText(notice("recoveryJoin", { name: "担当N", scope: "office" }))).toBe("復元キーで担当Nさんが加わりました");
    expect(storageNoticeText(notice("unavailable", { code: "E_OFFICE_UNAVAILABLE" }))).toContain("同期フォルダが見つかりません");
    expect(storageNoticeText(notice("closed"))).toContain("もう1台のPC");
    expect(storageNoticeText(notice("joinRequest", { count: 2 }))).toContain("承認はできません");
    expect(storageNoticeText(notice("localHouseholds", { count: 4 }))).toBe("このPCの中に、まだ同期フォルダへ移していない世帯が4件あります");
    expect(storageNoticeText(notice("syncCopies", { count: 1 }))).toContain("衝突の写し");
    expect(storageNoticeText(notice("recoveryNotKept", { scope: "local" }))).toBe("復元キーをまだ保管していません");
    expect(storageNoticeText(notice("needsRecovery"))).toContain("復元キーを入れてください");
  });
  it("失敗の文: 同期フォルダ向けの文が無ければ事務所の共有の文、それも無ければ符号", () => {
    expect(syncMessage("E_SYNC_RECOVERY_REQUIRED")).toContain("先に復元キーを保管");
    expect(syncMessage("E_OFFICE_FOLDER")).toContain("選べません");
    expect(syncMessage("E_X")).toContain("E_X");
  });
  it("画面の文にパスらしいものが無い", () => {
    for (const t of Object.values(SYNC_MESSAGES)) expect(/[\\/]Users|C:\\|lifeplan-office/.test(t), t).toBe(false);
  });
});
