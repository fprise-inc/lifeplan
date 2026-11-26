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
import { COPY_CAUTION, COPY_FAILED, COPY_OK, copyRecoveryKey, LATER_HINT, NOT_A_KEY_TEXT, RecoveryKeyBox, RecoveryPanel, recoveryKeyShape } from "../src/workspace/store/RecoveryPanel.tsx";
import { StoragePanel } from "../src/workspace/store/StoragePanel.tsx";
import { storageNoticeText, SYNC_MESSAGES, syncMessage } from "../src/workspace/store/storage.ts";

const no = async () => Promise.reject("E");
const office: OfficeHost = { status: no, start: no, join: no, cancel: no, approve: no, reject: no, remove: no, moveLocal: no, recover: no, end: no, dismissNotices: no, acceptRoster: no, defaults: async () => ({}), putDefaults: no, branding: async () => ({}), putBranding: no, pickLogo: async () => null, featureStatus: async () => ({ today: "2026-11-01", active: [], codes: [], invalid: [] }), addFeatureCode: no, removeFeatureCode: no, dismissFeatureNotice: no, checkFeatureCodes: no, decideFeatureCandidate: no, syncStart: no, syncOpen: no, syncEnd: no, notices: async () => [] };
const store: StoreHost = { status: no, list: no, create: no, open: no, previousGeneration: no, openPrevious: no, save: no, rename: no, remove: no, recoveryKey: no, acknowledgeRecovery: no, testRecoveryKey: no, restoreWithRecoveryKey: no, closeReady: async () => undefined, closeCancel: async () => undefined, forkInfo: no, resolveFork: no, resolveSyncCopies: no, leave: async () => undefined, devFileKeys: async () => false, listSamples: no, setCategory: no, assignSerial: no, makeSample: no, makeClient: no, updateSample: no, sampleReset: no, categories: no, setCategories: no };

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
    officeCode: "7K2M-QX9P-4HDN-R8VT",
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
  it("復元キーで PC が加わった通知・置かれた共有に加わる申請（承認はできない）・移していない世帯", () => {
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
    // 30日より長く使わなかった PC: 今の復元キーを入れて戻る（事務所の確かめ用の番号は出さない）
    const unverified = storage(personal({ state: "unavailable", problem: "E_OFFICE_ROSTER_UNVERIFIED", officeCode: null }));
    expect(unverified).toContain("30日より長くこのPCを使わなかった間に");
    expect(unverified).toContain("data-sync-accept-key");
    expect(unverified).toMatch(/data-sync-accept(?!-)[^>]*disabled|disabled[^>]*data-sync-accept(?!-)/);
    expect(unverified).not.toContain("確かめ用の番号");
    expect(missing).not.toContain("data-sync-accept-section");
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
  it("最初の案内には「復元キーで実際に開けるか試す」の欄を出さない。設定から開く画面（manage）には出す", () => {
    const first = rk({});
    expect(first).not.toContain("開けるか試す");
    expect(first).not.toContain("data-recovery-try");
    expect(first).not.toContain("data-recovery-input");
    expect(first).not.toContain("rk-test");
    for (const props of [{}, { shared: true }, { shared: true, personal: true }]) {
      const manage = renderToString(h(RecoveryPanel, { mode: "manage", store, status: ready(), onStatus: () => undefined, onClose: () => undefined, ...props }));
      expect(manage, JSON.stringify(props)).toContain("復元キーで実際に開けるか試す");
      expect(manage, JSON.stringify(props)).toContain("data-recovery-try");
    }
    // 鍵を戻す画面（restore）は今までどおり入れる欄がある
    const restore = renderToString(h(RecoveryPanel, { mode: "restore", store, status: null, onStatus: () => undefined, onClose: () => undefined }));
    expect(restore).toContain("復元キーを入れる");
    expect(restore).toContain("data-recovery-try");
  });
  it("最初の案内の残りの中身は、共有の事務所・同期フォルダ・2台目の PC の入口があるときも変わらない（「試す」だけが無い）", () => {
    const cases: { props: Record<string, unknown>; has: string[]; not: string[] }[] = [
      { props: {}, has: ["<h2 id=\"rk-title\">復元キー</h2>", "rk-advice", "rk-later", "data-recovery-close"], not: ["data-recovery-second-pc", "data-recovery-shared", "data-recovery-personal"] },
      { props: { onOpenSync: () => undefined }, has: ["data-recovery-second-pc", "rk-advice", "rk-later", "data-recovery-close"], not: ["data-recovery-shared", "data-recovery-personal"] },
      { props: { shared: true }, has: ["事務所の復元キー", "data-recovery-shared", "rk-advice", "data-recovery-close"], not: ["data-recovery-second-pc", "rk-later"] },
      { props: { shared: true, personal: true, onOpenSync: () => undefined }, has: ["復元キー（同期フォルダ）", "data-recovery-personal", "rk-advice", "data-recovery-close"], not: ["data-recovery-second-pc", "rk-later"] },
    ];
    for (const c of cases) {
      const html = rk(c.props);
      const name = Object.keys(c.props).join(",") || "PCの中だけ";
      for (const x of c.has) expect(html, name).toContain(x);
      for (const x of c.not) expect(html, name).not.toContain(x);
      expect(html, name).not.toContain("開けるか試す");
      expect(html, name).not.toContain("data-recovery-try");
      // 最初の案内では「あとで保管する」で閉じる（保管するかは FP が選ぶ）。あとから開く道も書く（どの場合も同じ道）
      expect(html, name).toContain(">あとで保管する</button>");
      expect(html, name).toContain("data-recovery-later-hint");
      expect(html, name).toContain(LATER_HINT);
    }
  });
  it("一番下のボタンは、まだ保管していなければ「あとで保管する」、保管したら「閉じる」。あとから開く道の文は、最初の案内でまだ保管していないときだけ", () => {
    const first = rk({});
    expect(first).toContain(">あとで保管する</button>");
    expect(first).not.toContain(">閉じる</button>");
    const keptFirst = renderToString(h(RecoveryPanel, { mode: "first", store, status: ready({ firstRun: true, recoveryAcknowledged: true }), onStatus: () => undefined, onClose: () => undefined }));
    expect(keptFirst).toContain(">閉じる</button>");
    expect(keptFirst).not.toContain("あとで保管する");
    expect(keptFirst).not.toContain("data-recovery-later-hint");
    for (const acknowledged of [false, true]) {
      const manage = renderToString(h(RecoveryPanel, { mode: "manage", store, status: ready({ recoveryAcknowledged: acknowledged }), onStatus: () => undefined, onClose: () => undefined }));
      expect(manage).toContain(acknowledged ? ">閉じる</button>" : ">あとで保管する</button>");
      // 設定から開く画面は、すでにその道の先なので書かない
      expect(manage).not.toContain("data-recovery-later-hint");
    }
    // 道の文は、世帯の一覧の下のボタンの名前（「復元キー」）と同じ
    expect(LATER_HINT).toContain("世帯の一覧");
    expect(LATER_HINT).toContain("「復元キー」");
  });
  it("「事務所の共有」の場所を書き、開くボタンを置く（PC の中だけのとき）", () => {
    const html = rk({ onStorage: () => undefined, onOffice: () => undefined });
    expect(html).toContain("上の帯の FP のメニュー〔かばんのアイコン〕の「事務所の設定」にあります");
    expect(html).toContain("data-recovery-to-office");
    expect(html).toContain(">事務所の共有を開く</button>");
    expect(html).toContain("data-recovery-to-storage");
    expect(rk({})).not.toContain("data-recovery-to-office");
    // 共有の事務所・同期フォルダで使っているときは、この案内自体を出さない
    expect(rk({ onOffice: () => undefined, shared: true })).not.toContain("data-recovery-to-office");
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

describe("入れた中身が復元キーの形か（打ち間違いと、復元キーでない物を分ける）", () => {
  // 形の合う見本（58文字・4文字ずつ区切りで72文字。確かめ用の照合は本体がする）
  const KEY = Array.from({ length: 58 }, (_, i) => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[(i * 7 + 3) % 32]).join("").replace(/(.{4})(?=.)/g, "$1-");
  it("ちょうどキーの形・1字違い・区切りや空白や改行の違い・小文字・全角は、復元キーとして本体に渡す（打ち間違いは本体が判定）", () => {
    expect(KEY.length).toBe(72);
    expect(recoveryKeyShape(KEY)).toBe("key");
    expect(recoveryKeyShape(`${KEY.slice(0, 10)}${KEY[10] === "A" ? "B" : "A"}${KEY.slice(11)}`)).toBe("key");
    expect(recoveryKeyShape(KEY.replace("A", "U"))).toBe("key");
    expect(recoveryKeyShape(KEY.replaceAll("-", ""))).toBe("key");
    expect(recoveryKeyShape(`  ${KEY.replaceAll("-", " ")}\n`)).toBe("key");
    expect(recoveryKeyShape(KEY.replaceAll("-", "\r\n"))).toBe("key");
    expect(recoveryKeyShape(KEY.toLowerCase())).toBe("key");
    expect(recoveryKeyShape(KEY.replace(/[0-9A-Z]/g, (c) => String.fromCodePoint((c.codePointAt(0) ?? 0) + 0xfee0)))).toBe("key");
    // 1組（4文字）が抜けた・重なったのは打ち間違い
    expect(recoveryKeyShape(KEY.slice(0, 67))).toBe("key");
    expect(recoveryKeyShape(`${KEY}-ABCD`)).toBe("key");
  });
  it("アドレス・短すぎ・長すぎ・使わない文字が多いものは、復元キーでない物として分ける", () => {
    expect(recoveryKeyShape("https://github.com/fprise-inc/lifeplan")).toBe("notKey");
    expect(recoveryKeyShape("github.com/fprise-inc/lifeplan/pull/1")).toBe("notKey");
    expect(recoveryKeyShape("www.example.com")).toBe("notKey");
    expect(recoveryKeyShape("someone@example.com")).toBe("notKey");
    expect(recoveryKeyShape(KEY.slice(0, 40))).toBe("notKey");
    expect(recoveryKeyShape(`${KEY}-${KEY}`)).toBe("notKey");
    expect(recoveryKeyShape("ABCD")).toBe("notKey");
    expect(recoveryKeyShape(KEY.replace(/^.{0,9}/, "UUUUUUUUU"))).toBe("notKey");
    expect(recoveryKeyShape("復元キーはここに貼り付けてください。復元キーはここに貼り付けてください。復元キーはここに貼り付けてください。")).toBe("notKey");
  });
  it("知らせの文は、打ち間違いとは別で、形と文字数を書く", () => {
    expect(NOT_A_KEY_TEXT).toContain("復元キーではない文字");
    expect(NOT_A_KEY_TEXT).toContain("72文字");
    expect(NOT_A_KEY_TEXT).not.toContain("打ち間違い");
  });
});

describe("復元キーの「コピー」", () => {
  const KEY = Array.from({ length: 58 }, (_, i) => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[(i * 11 + 5) % 32]).join("").replace(/(.{4})(?=.)/g, "$1-");
  it("キーの枠の横に「コピー」と、クリップボードの履歴・同期に残る注意を出す", () => {
    const html = renderToString(h(RecoveryKeyBox, { value: KEY }));
    expect(html).toContain("data-recovery-key");
    expect(html).toContain(">コピー</button>");
    expect(html).toContain("data-recovery-copy-caution");
    expect(html).toContain(COPY_CAUTION);
    expect(COPY_CAUTION).toContain("クリップボードの履歴");
    expect(COPY_CAUTION).toContain("アプリからは消せない");
    // キーは5組ずつの行で出す（コピーする中身は区切りつきの72文字のまま）
    expect(html).toContain(KEY.split("-").slice(0, 5).join("-"));
  });
  it("押すとキー（72文字のまま）をクリップボードに渡し、できたと知らせる", async () => {
    const got: string[] = [];
    const r = await copyRecoveryKey(KEY, async (t) => {
      got.push(t);
    });
    expect(got).toEqual([KEY]);
    expect(got[0]?.length).toBe(72);
    expect(r).toEqual({ ok: true, text: COPY_OK });
  });
  it("写せないとき（許可が無い・クリップボードが使えない）は、できなかったと知らせ、ほかの保管の仕方を書く", async () => {
    const r = await copyRecoveryKey(KEY, async () => Promise.reject(new Error("NotAllowedError")));
    expect(r).toEqual({ ok: false, text: COPY_FAILED });
    expect(COPY_FAILED).toContain("コピーできませんでした");
    expect(COPY_FAILED).toContain("印刷");
    // navigator.clipboard が無い環境（テストの node）でも、投げずに知らせを返す
    const r2 = await copyRecoveryKey(KEY);
    expect(r2.ok).toBe(false);
  });
});

describe("WebView2 の一般の自動入力", () => {
  it("main のウィンドウで切っている（入力欄の autocomplete=\"off\" を守らないことがあるため。0016 の追記）", async () => {
    const { readFile } = await import("node:fs/promises");
    const conf = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")) as { app: { windows: { label: string; generalAutofillEnabled?: boolean; incognito?: boolean }[] } };
    const main = conf.app.windows.find((w) => w.label === "main");
    expect(main?.generalAutofillEnabled).toBe(false);
    expect(main?.incognito).toBe(true);
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
