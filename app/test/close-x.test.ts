// 重ねて出す物の閉じ方（0239）: どの画面も右上の同じ丸い ×（.x-btn）と Esc で閉じる。
// - Esc の受け方: 重ねて出しているときは上の1つだけ・文字を打つ欄にいるときは閉じない（閉じる前に値を決める物だけ受ける）・
//   日本語の変換中・開いているプルダウンでは閉じない・中の部品が先に受けた Esc は受けない・選ばせる問いは閉じずに下にも渡さない
// - 画面ごと: × を押すと閉じる処理を呼ぶこと、Esc の受け手として重ねること（どの物を・欄にいても受けるか）
// - 前の形の × と、物ごとの Esc の受け方が残っていないこと（ソースの文字で見る）
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { h, options, type VNode } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_DIR } from "../scripts/lib.ts";
import { CompareCard } from "../src/presentation/Compare.tsx";
import { EvidencePanel } from "../src/presentation/EvidencePanel.tsx";
import { AiConnectorPanel } from "../src/workspace/ai/AiConnectorPanel.tsx";
import { AiHearingPanel } from "../src/workspace/ai/AiHearingIssued.tsx";
import { AiHouseholdCandidates } from "../src/workspace/ai/AiHouseholdCandidates.tsx";
import { AiSharePanel } from "../src/workspace/ai/AiSharePanel.tsx";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { ChoicePanel } from "../src/workspace/ChoicePanel.tsx";
import { DocumentReview } from "../src/workspace/documents/DocumentReview.tsx";
import { DocumentStart } from "../src/workspace/documents/DocumentStart.tsx";
import { FpMenu } from "../src/workspace/header/FpMenu.tsx";
import { EMPTY_OFFICE_HEARING } from "../src/workspace/hearing/aiHearing.ts";
import { DocViewer } from "../src/workspace/hearing/DocViewer.tsx";
import { ReviewPanel } from "../src/workspace/hearing/HearingTools.tsx";
import { ReceivedDocs, type ReceivedDocsState } from "../src/workspace/hearing/ReceivedDocs.tsx";
import { WebBuilder } from "../src/workspace/hearing/WebBuilder.tsx";
import { CheckList } from "../src/workspace/input/CheckList.tsx";
import { DocRequests } from "../src/workspace/input/DocRequests.tsx";
import { fromRequest } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { ImportMenu } from "../src/workspace/input/InputView.tsx";
import { ItemChooser } from "../src/workspace/input/ItemChooser.tsx";
import { inputItems } from "../src/workspace/input/items.ts";
import { MeetingTools } from "../src/workspace/meetings/MeetingTools.tsx";
import { MemoDrawer } from "../src/workspace/MemoDrawer.tsx";
import { FeedbackPanel } from "../src/workspace/notices/FeedbackPanel.tsx";
import { NoticeCenter } from "../src/workspace/notices/NoticeCenter.tsx";
import { DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { PlanList } from "../src/workspace/plans/PlanList.tsx";
import { roles } from "../src/workspace/roles.ts";
import { SnapshotTools } from "../src/workspace/snapshots/SnapshotTools.tsx";
import { StatementPanel } from "../src/workspace/statement/StatementPanel.tsx";
import { ForkPanel } from "../src/workspace/store/ForkPanel.tsx";
import { HouseholdPanel } from "../src/workspace/store/HouseholdPanel.tsx";
import { OfficePanel } from "../src/workspace/store/OfficePanel.tsx";
import { PreviousPanel } from "../src/workspace/store/PreviousPanel.tsx";
import { RecoveryPanel } from "../src/workspace/store/RecoveryPanel.tsx";
import { StoragePanel } from "../src/workspace/store/StoragePanel.tsx";
import { FpTools } from "../src/workspace/tools/FpTools.tsx";
import { modelHousehold } from "./helpers.ts";

/** 描いている間に、部品が重ねると言った Esc の受け手（本物の useEscClose は、画面に出た後で重ねる。ここでは言った中身だけを集める） */
interface Declared {
  close: (() => void) | null;
  on: boolean;
  /** 欄にいても受ける */
  typing: boolean;
  /** 横に並ぶ物（ほかの物の下に置く） */
  side: boolean;
}
const declared = vi.hoisted(() => ({ list: [] as { close: (() => void) | null; on: boolean; typing: boolean; side: boolean }[] }));
vi.mock("../src/presentation/CloseX.tsx", async (original) => {
  const real = await original<typeof import("../src/presentation/CloseX.tsx")>();
  return { ...real, useEscClose: (close: (() => void) | null, on = true, how: { typing?: boolean; side?: boolean } = {}) => void declared.list.push({ close, on, typing: how.typing === true, side: how.side === true }) };
});
const real = await vi.importActual<typeof import("../src/presentation/CloseX.tsx")>("../src/presentation/CloseX.tsx");

// 元に戻すの記録が操作の場所を DOM の要素で見る（Node には無いので、空の型を置く）
const g = globalThis as { Element?: unknown };
const hadElement = "Element" in g;
beforeAll(() => {
  if (!hadElement) g.Element = class {};
});
afterAll(() => {
  if (!hadElement) delete g.Element;
});

type Props = Record<string, unknown>;
/** 描いて、右上の ×（.x-btn）と、Esc の受け手（出している物だけ）を集める */
function parts(node: VNode<any>): { html: string; xs: VNode<Props>[]; esc: Declared[] } { // eslint-disable-line @typescript-eslint/no-explicit-any
  const xs: VNode<Props>[] = [];
  const prev = options.vnode;
  options.vnode = (v) => {
    if (v.type === "button" && (v.props as Props).class === "x-btn") xs.push(v as VNode<Props>);
    prev?.(v);
  };
  declared.list = [];
  try {
    const html = renderToString(node);
    return { html, xs, esc: declared.list.filter((d) => d.on) };
  } finally {
    options.vnode = prev;
  }
}
const noop = () => undefined;
const wh = () => fromRequest(modelHousehold("salariedCoupleTwoKids"));

// ---- Esc の受け方（本物の重ね方） ----

interface FakeKey {
  key: string;
  defaultPrevented: boolean;
  isComposing: boolean;
  keyCode: number;
  target: unknown;
  preventDefault: () => void;
}
function esc(over: Partial<FakeKey> = {}): FakeKey {
  const e: FakeKey = { key: "Escape", defaultPrevented: false, isComposing: false, keyCode: 27, target: { tagName: "BUTTON" }, preventDefault: () => void (e.defaultPrevented = true), ...over };
  return e;
}
const press = (e: FakeKey) => (real.escKey(e as never), e);
const INPUT = { tagName: "INPUT", type: "text" };

describe("Esc の受け方（重ねて出した物の上の1つだけ）", () => {
  let off: (() => void)[] = [];
  const layer = (close: (() => void) | null, typing = false, side = false) => off.push(real.pushEscLayer({ current: { close, typing } }, side));
  beforeEach(() => {
    for (const f of off) f();
    off = [];
  });

  it("何も出していなければ何もしない（後ろの画面の Esc に渡す）", () => {
    expect(press(esc()).defaultPrevented).toBe(false);
  });

  it("重ねて2つ出しているときは、後から出した1つだけを閉じる。閉じた後の Esc で下の1つを閉じる", () => {
    const log: string[] = [];
    layer(() => log.push("下"));
    layer(() => log.push("上"));
    expect(press(esc()).defaultPrevented).toBe(true);
    expect(log).toEqual(["上"]);
    off.pop()?.();
    press(esc());
    expect(log).toEqual(["上", "下"]);
  });

  it("先に出した物を先に閉じても、残りの順は変わらない", () => {
    const log: string[] = [];
    layer(() => log.push("下"));
    layer(() => log.push("上"));
    off[0]?.();
    press(esc());
    expect(log).toEqual(["上"]);
  });

  it("横に並ぶ物（右の引き出し・届いた書類の枠）は、後から出しても下に置く: 入力項目のパネルが先に閉じ、次の Esc で閉じる", () => {
    const log: string[] = [];
    layer(() => log.push("パネル"));
    layer(() => log.push("引き出し"), false, true);
    press(esc());
    expect(log).toEqual(["パネル"]);
    off[0]?.();
    press(esc());
    expect(log).toEqual(["パネル", "引き出し"]);
  });

  it("文字を打つ欄・選ぶ欄にいるときは閉じない（Esc も止めない）。チェック・ボタンにいるときは閉じる", () => {
    let n = 0;
    layer(() => n++);
    for (const target of [INPUT, { tagName: "INPUT", type: "search" }, { tagName: "INPUT", type: "number" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }]) {
      expect(press(esc({ target })).defaultPrevented, JSON.stringify(target)).toBe(false);
    }
    expect(n).toBe(0);
    for (const target of [{ tagName: "INPUT", type: "checkbox" }, { tagName: "INPUT", type: "radio" }, { tagName: "INPUT", type: "range" }, { tagName: "BUTTON" }, { tagName: "DIV" }, null]) press(esc({ target }));
    expect(n).toBe(6);
  });

  it("欄にいても受ける物（閉じる前に打ちかけの値を決める入力項目のパネル）は、欄にいるときも閉じる処理を呼ぶ", () => {
    let n = 0;
    layer(() => n++, true);
    expect(press(esc({ target: INPUT })).defaultPrevented).toBe(true);
    expect(n).toBe(1);
  });

  it("日本語の変換中の Esc では閉じない（欄にいても受ける物も）", () => {
    let n = 0;
    layer(() => n++, true);
    expect(press(esc({ target: INPUT, isComposing: true })).defaultPrevented).toBe(false);
    expect(press(esc({ target: INPUT, keyCode: 229 })).defaultPrevented).toBe(false);
    expect(n).toBe(0);
  });

  it("開いているプルダウンの Esc では閉じない（欄にいても受ける物も）。開いているかを聞けない画面・閉じているプルダウンは、ふだんどおり", () => {
    let n = 0;
    layer(() => n++, true);
    press(esc({ target: { tagName: "SELECT", matches: (q: string) => q === ":open" } }));
    expect(n).toBe(0);
    press(esc({ target: { tagName: "SELECT", matches: () => false } }));
    press(esc({
      target: {
        tagName: "SELECT",
        matches: () => {
          throw new Error("SyntaxError");
        },
      },
    }));
    expect(n).toBe(2);
  });

  it("中の部品（説明の「?」・選択肢の一覧・年の固定）が先に受けた Esc は受けない", () => {
    let n = 0;
    layer(() => n++);
    press(esc({ defaultPrevented: true }));
    expect(n).toBe(0);
  });

  it("Esc のほかのキーは受けない", () => {
    let n = 0;
    layer(() => n++);
    expect(press(esc({ key: "Enter" })).defaultPrevented).toBe(false);
    expect(n).toBe(0);
  });

  it("選ばせる問い（閉じる処理が無い物）は閉じないが、下の物にも後ろの画面にも Esc を渡さない", () => {
    let n = 0;
    layer(() => n++);
    layer(null);
    expect(press(esc()).defaultPrevented).toBe(true);
    expect(n).toBe(0);
  });

  it("× の読み上げ: 「メモを閉じる（Esc）」。物の名前が無ければ「閉じる（Esc）」", () => {
    expect(real.closeLabel("メモ")).toBe("メモを閉じる（Esc）");
    expect(real.closeLabel()).toBe("閉じる（Esc）");
    const html = renderToString(h(real.CloseX, { onClose: noop, what: "メモ", "data-x": true }));
    expect(html).toBe('<button type="button" class="x-btn" aria-label="メモを閉じる（Esc）" title="閉じる（Esc）" data-x="true">×</button>');
  });
});

// ---- 画面ごと ----

const no = async (): Promise<never> => Promise.reject("E");
const ready = { state: "ready" as const, firstRun: false, recoveryAcknowledged: true, recoveryVerifiedAt: null, lastOpened: null, deletionsPending: 0, deletionsCompleted: 0 };
const anyHost = new Proxy({}, { get: () => no }) as never;

interface Screen {
  /** 画面の名前（どの種類の重ねて出す物か） */
  name: string;
  /** 閉じる処理を受け取って描く */
  node: (onClose: () => void) => VNode<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** × の読み上げ */
  label: string;
  /** 欄にいても Esc を受ける（既定は受けない） */
  typing?: boolean;
  /** 横に並ぶ物（ほかの物の下に置く） */
  side?: boolean;
  /** 足元の「閉じる」を残す（中央のパネル） */
  foot?: boolean;
}

function planList(onClose: () => void) {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  const w = fromRequest(req);
  return h(PlanList, { wh: w, catalog: buildCatalog(w, self.id, demoHousehold("salariedCoupleTwoKids") ?? null), letters: new Map(), band: [], onBand: noop, onEdit: noop, onReflect: noop, onClose, stored: true });
}
const rd = (over: Partial<ReceivedDocsState>): ReceivedDocsState => ({ files: [], names: new Map(), viewing: null, view: noop, listOpen: true, setListOpen: noop, markViewed: noop, canSave: true, save: async () => "", remove: noop, note: null, pending: [], ...over });
const householdBase = { status: ready, unavailable: null, error: null, list: [], currentId: null, categories: [], shelf: [], currentSample: null, currentMark: null, onOpen: noop, onNew: noop, onCreate: noop, onRename: noop, onRemove: noop, onRecovery: noop, onStorage: noop, onOffice: noop };

const SCREENS: Screen[] = [
  // 世帯の選択
  { name: "世帯の一覧", node: (onClose) => h(HouseholdPanel, { ...householdBase, onClose } as never), label: "世帯の一覧を閉じる（Esc）" },
  // 中央のパネル
  { name: "事務所の既定値", node: (onClose) => h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, onSave: async () => undefined, shared: false, onClose }), label: "事務所の既定値を閉じる（Esc）", foot: true },
  { name: "要望・不具合を送る", node: (onClose) => h(FeedbackPanel, { receipts: [], template: "https://example.com/f?no={受付番号}", appVersion: "0.1.0", os: "macOS", onSend: async () => undefined, onAdd: noop, onClose, initialCode: "R-7K2Q" }), label: "要望・不具合を送るを閉じる（Esc）", foot: true },
  { name: "保存先", node: (onClose) => h(StoragePanel, { office: anyHost, status: null, storeStatus: ready, notices: [], focus: null, onStatus: noop, onHouseholdsChanged: noop, onRecovery: noop, onOffice: noop, onClose }), label: "保存先を閉じる（Esc）", foot: true },
  { name: "事務所の共有", node: (onClose) => h(OfficePanel, { office: anyHost, status: null, onStatus: noop, onHouseholdsChanged: noop, onRecovery: noop, onClose }), label: "事務所の共有を閉じる（Esc）", foot: true },
  { name: "復元キー", node: (onClose) => h(RecoveryPanel, { mode: "manage", store: anyHost, status: ready, onStatus: noop, onClose }), label: "復元キーを閉じる（Esc）", foot: true },
  { name: "分岐の知らせ（同期サービスの写しだけ）", node: (onClose) => h(ForkPanel, { customerNo: "A0001", info: { savedConflict: false, theirsSavedAt: null, theirsBy: null, theirsGeneration: 1, oursGeneration: 1, syncCopies: 2, personal: false }, busy: false, error: null, onChoose: noop, onSyncCopies: noop, onClose }), label: "分岐の知らせを閉じる（Esc）", foot: true },
  { name: "直前の保存で開き直す", node: (onClose) => h(PreviousPanel, { customerNo: "A0001", reason: "", info: { generation: 3, savedAt: null, savedBy: null }, busy: false, error: null, onOpen: noop, onClose }), label: "閉じる（Esc）" },
  { name: "この書類を読む", node: (onClose) => h(DocumentStart, { wh: wh(), start: { title: "保険証券（ご本人）", docType: "insurancePolicy" }, onClose } as never), label: "この書類を読むを閉じる（Esc）", foot: true },
  { name: "書類の読み取りの確認（読んだ書類なし）", node: (onClose) => h(DocumentReview, { wh: wh(), calc: null, onChange: noop, onClose }), label: "書類の読み取りの確認を閉じる（Esc）", foot: true },
  // AI と接続する画面
  { name: "AI との接続", node: (onClose) => h(AiConnectorPanel, { ai: anyHost, status: null, onStatus: noop, onChanged: noop, onClose }), label: "AI との接続を閉じる（Esc）", foot: true },
  { name: "AIとの共有", node: (onClose) => h(AiSharePanel, { ai: anyHost, householdId: "h", customerNo: "A0001", status: null, view: null, onView: noop, onOpenConnector: noop, onClose }), label: "AIとの共有を閉じる（Esc）", foot: true },
  { name: "AI が発行した URL", node: (onClose) => h(AiHearingPanel, { store: EMPTY_OFFICE_HEARING, web: null, officeName: "", opened: null, onEntry: async () => undefined, onAssignOpened: async () => true, onCreate: async () => null, onOpenHousehold: noop, onClose }), label: "AI が発行した URLを閉じる（Esc）", foot: true },
  { name: "AIからの新しい世帯の候補", node: (onClose) => h(AiHouseholdCandidates, { candidates: [], onCreate: async () => null, onDiscard: async () => null, onClose }), label: "AIからの新しい世帯の候補を閉じる（Esc）", foot: true },
  // 入力項目のパネル
  { name: "入力項目のパネル", node: (onClose) => h(InputPanel, { wh: wh(), itemId: "family", level: "simple", onLevel: noop, onSave: noop, onClose }), label: "閉じる（Esc）", typing: true },
  { name: "明細から生活費を出す", node: (onClose) => h(StatementPanel, { wh: wh(), host: anyHost, onLog: noop, onApprove: noop, onClose }), label: "閉じる（Esc）", foot: true },
  // 右の引き出し
  { name: "メモ", node: (onClose) => h(MemoDrawer, { wh: wh(), onEdit: noop, onClose }), label: "メモを閉じる（Esc）", side: true },
  { name: "根拠", node: (onClose) => h(EvidencePanel, { state: { status: "loading", title: "手取り" }, onClose }), label: "根拠を閉じる（Esc）", side: true },
  // 入力のホーム・結果のタブの中で開く物
  { name: "この時点を残す", node: (onClose) => h(SnapshotTools, { list: [], stored: true, onTake: async () => undefined, onRemove: noop, bar: false, mode: "take", onMode: onClose }), label: "この時点を残すを閉じる（Esc）" },
  { name: "控えの一覧", node: (onClose) => h(SnapshotTools, { list: [], stored: true, onTake: async () => undefined, onRemove: noop, bar: false, mode: "list", onMode: onClose }), label: "控えの一覧を閉じる（Esc）" },
  { name: "世帯の中身の一覧", node: (onClose) => h(FpTools, { wh: wh(), result: null, onOpen: noop, bar: false, tool: "contents", onTool: onClose }), label: "世帯の中身の一覧を閉じる（Esc）" },
  { name: "次の1年に起きること", node: (onClose) => h(FpTools, { wh: wh(), result: null, onOpen: noop, bar: false, tool: "year", onTool: onClose }), label: "次の1年に起きることを閉じる（Esc）" },
  { name: "前回から変わったこと", node: (onClose) => h(FpTools, { wh: wh(), result: null, onOpen: noop, bar: false, tool: "review", onTool: onClose }), label: "前回から変わったことを閉じる（Esc）" },
  { name: "面談の履歴", node: (onClose) => h(MeetingTools, { wh: wh(), onSave: noop, onClose, result: null, onOpen: noop }), label: "面談の履歴を閉じる（Esc）" },
  { name: "事前ヒアリング・取り込む", node: (onClose) => h(ImportMenu, { button: false, open: true, onOpen: onClose }, h("span", null, "中身")), label: "事前ヒアリング・取り込むを閉じる（Esc）" },
  { name: "URL生成", node: (onClose) => h(WebBuilder, { wh: wh(), web: anyHost, office: { name: "", color: null }, templates: [], onTemplates: async () => undefined, customerNo: "B0007", persisted: true, onSave: noop, saveNow: async () => true, onClose }), label: "URL生成を閉じる（Esc）" },
  { name: "確かめの一覧", node: (onClose) => h(CheckList, { wh: wh(), onEdit: noop, onOpen: noop, onClose }), label: "確かめの一覧を閉じる（Esc）" },
  { name: "書類のお願い", node: (onClose) => h(DocRequests, { wh: wh(), onOpen: noop, onClose }), label: "書類のお願いを閉じる（Esc）" },
  { name: "受け取った書類", node: (onClose) => h(ReceivedDocs, { rd: rd({ setListOpen: onClose }) }), label: "受け取った書類を閉じる（Esc）" },
  { name: "プランの一覧", node: planList, label: "プランの一覧を閉じる（Esc）" },
  { name: "プランの比較", node: (onClose) => h(CompareCard, { title: "プランの比較（2つ。基準: プランA）", note: "計算しています…", onClose }), label: "プランの比較を閉じる（Esc）" },
];

describe("画面ごと: 右上の × と Esc で閉じる", () => {
  for (const s of SCREENS) {
    it(`${s.name}: × は1つ（${s.label}）。押すと閉じる処理を呼ぶ。Esc の受け手として重ねる${s.typing === true ? "（欄にいても受ける）" : ""}`, () => {
      let closed = 0;
      const p = parts(s.node(() => closed++));
      expect(p.xs.map((x) => x.props["aria-label"])).toEqual([s.label]);
      expect(p.xs[0]?.props.title).toBe("閉じる（Esc）");
      (p.xs[0]?.props.onClick as () => void)();
      expect(closed, "×").toBe(1);
      // Esc: この物の閉じる処理を、1つだけ重ねる
      expect(p.esc).toHaveLength(1);
      expect(p.esc[0]?.typing).toBe(s.typing === true);
      expect(p.esc[0]?.side).toBe(s.side === true);
      p.esc[0]?.close?.();
      expect(closed, "Esc").toBe(2);
      // 足元の「閉じる」は、中央のパネルだけに残す
      const foot = />\s*閉じる\s*<\/button>/.test(p.html);
      expect(foot, "足元の「閉じる」").toBe(s.foot === true);
    });
  }

  it("お知らせ（帯の下の一覧）: 頭の行の右上に ×（「すべて既読にする」の右）。開いている間だけ Esc の受け手として重ねる", () => {
    const p = parts(h(NoticeCenter, { items: [], onRead: noop, initialOpen: true }));
    expect(p.xs.map((x) => x.props["aria-label"])).toEqual(["お知らせを閉じる（Esc）"]);
    expect(p.html).toMatch(/class="nc-top">.*すべて既読にする.*data-notice-close/);
    expect(p.esc).toHaveLength(1);
    expect(p.esc[0]?.typing).toBe(false);
    expect(parts(h(NoticeCenter, { items: [], onRead: noop })).esc).toHaveLength(0);
  });

  it("お知らせの詳しい中身: Esc は上の1つだけ（詳しい中身 → 一覧 → お知らせを閉じる。0245 の追記）。Esc は「‹ 一覧に戻る」と同じ、× はお知らせごと閉じる", () => {
    const one = { key: "k1", category: "office" as const, urgency: "normal" as const, date: null, title: "題", body: "本文", household: null, receipts: [], action: null, todo: false, read: false };
    const backs: VNode<Props>[] = [];
    const prev = options.vnode;
    options.vnode = (v) => {
      if (v.type === "button" && "data-notice-back" in (v.props as Props)) backs.push(v as VNode<Props>);
      prev?.(v);
    };
    let detail: ReturnType<typeof parts>;
    try {
      detail = parts(h(NoticeCenter, { items: [one], onRead: noop, initialOpen: true, initialSel: "k1" }));
    } finally {
      options.vnode = prev;
    }
    expect(detail.html).toContain('data-notice-detail="k1"');
    expect(detail.esc).toHaveLength(1);
    expect(detail.esc[0]?.close).toBe(backs[0]?.props.onClick);
    expect(detail.esc[0]?.close).not.toBe(detail.xs[0]?.props.onClick);
    // 一覧では、Esc は × と同じ（お知らせを閉じる）
    const list = parts(h(NoticeCenter, { items: [one], onRead: noop, initialOpen: true }));
    expect(list.html).not.toContain("data-notice-detail");
    expect(list.esc[0]?.close).toBe(list.xs[0]?.props.onClick);
    // 開いていた1件が一覧から無くなったときは、Esc でお知らせを閉じる
    const gone = parts(h(NoticeCenter, { items: [], onRead: noop, initialOpen: true, initialSel: "k1" }));
    expect(gone.esc[0]?.close).toBe(gone.xs[0]?.props.onClick);
    // 一覧に戻ったら、開いていた行に選択を戻す
    const src = readFileSync(join(APP_DIR, "src", "workspace", "notices", "NoticeCenter.tsx"), "utf8");
    expect(src).toMatch(/refocus\.current = sel;/);
    expect(src).toMatch(/getAttribute\("data-notice"\) === k\)\?\.focus\(\)/);
  });

  it("FP のメニュー（項目を選ぶ一覧）は × を置かず、Esc で閉じる。入力項目を選ぶの小さな一覧も Esc の受け手として重ねる", () => {
    const menu = parts(h(FpMenu, { groups: [{ id: "notes", label: "記録", items: [{ action: "memo", label: "メモ" }] }], onPick: noop, initialOpen: true }));
    expect(menu.xs).toHaveLength(0);
    expect(menu.esc).toHaveLength(1);
    expect(parts(h(FpMenu, { groups: [], onPick: noop })).esc).toHaveLength(0);
    const w = wh();
    const chooser = parts(h(ItemChooser, { wh: w, items: inputItems(w), onChange: noop, initialOpen: true }));
    expect(chooser.esc).toHaveLength(1);
    expect(parts(h(ItemChooser, { wh: w, items: inputItems(w), onChange: noop })).esc).toHaveLength(0);
  });

  it("閉じている物は、Esc の受け手として重ねない（控え・取り込む・受け取った書類の枠）", () => {
    expect(parts(h(SnapshotTools, { list: [], stored: true, onTake: async () => undefined, onRemove: noop, bar: false, mode: null, onMode: noop })).esc).toHaveLength(0);
    expect(parts(h(ImportMenu, { button: false, open: false, onOpen: noop })).esc).toHaveLength(0);
    // 「取り込む ▾」のボタンで開いた中身は、今までどおりボタンで閉じる
    expect(parts(h(ImportMenu, { initialOpen: true }, h("span", null, "中身"))).esc).toHaveLength(0);
    expect(parts(h(DocViewer, { rd: rd({}), beside: false })).esc).toHaveLength(0);
    expect(parts(h(DocRequests, { wh: wh(), onOpen: noop })).xs).toHaveLength(0);
    expect(parts(h(CheckList, { wh: wh(), onEdit: noop, onOpen: noop })).xs).toHaveLength(0);
  });

  it("届いた書類の枠: 右上の ×（書類を閉じる）。横に並ぶ物として重ねる（入力項目のパネルが先）", () => {
    let closed = 0;
    const file = { requestId: "R-1", doc: { id: "d1", kind: "withholding", title: "源泉徴収票（ご本人）", purpose: "", where: "" }, name: "源泉徴収票", whose: "ご本人", file: { fileId: "f1", documentId: "d1", type: "image/jpeg", size: 1000, batch: "b1" }, receivedAt: "2026-11-06T03:00:00Z", sentAt: null, index: 1, count: 1 };
    const p = parts(h(DocViewer, { rd: rd({ files: [file as never], viewing: "f1", view: () => void closed++ }), beside: true }));
    expect(p.xs.map((x) => x.props["aria-label"])).toEqual(["書類を閉じる（Esc）"]);
    (p.xs[0]?.props.onClick as () => void)();
    expect(p.esc).toHaveLength(1);
    expect(p.esc[0]).toMatchObject({ typing: false, side: true });
    p.esc[0]?.close?.();
    expect(closed).toBe(2);
  });

  it("確かめの問い: × と Esc は「やめる」。保存している間は × を押せず、Esc でも閉じない（下の物にも渡さない）", () => {
    const chosen: string[] = [];
    const node = (busy: boolean) =>
      h(ChoicePanel<"go" | "cancel">, { name: "leave", title: "保存していない変更があります", choices: [{ key: "go", label: "捨てて進む", note: "" }, { key: "cancel", label: "やめる", note: "" }], cancel: "cancel", busy, onChoose: (k: string) => void chosen.push(k), children: null });
    const p = parts(node(false));
    expect(p.xs.map((x) => x.props["aria-label"])).toEqual(["閉じる（Esc）"]);
    expect(p.xs[0]?.props.disabled).toBe(false);
    (p.xs[0]?.props.onClick as () => void)();
    p.esc[0]?.close?.();
    expect(chosen).toEqual(["cancel", "cancel"]);
    const busy = parts(node(true));
    expect(busy.xs[0]?.props.disabled).toBe(true);
    expect(busy.esc).toEqual([{ close: null, on: true, typing: false, side: false }]);
  });

  it("選ばせる画面は閉じられない: 分岐（どちらを残すか）と鍵を戻す画面は × を出さず、Esc を下の物にも渡さない", () => {
    const fork = parts(h(ForkPanel, { customerNo: "A0001", info: { savedConflict: true, theirsSavedAt: null, theirsBy: "担当B", theirsGeneration: 5, oursGeneration: 5, syncCopies: 0, personal: false }, busy: false, error: null, onChoose: noop, onSyncCopies: noop, onClose: noop }));
    expect(fork.xs).toHaveLength(0);
    expect(fork.esc).toEqual([{ close: null, on: true, typing: false, side: false }]);
    const restore = parts(h(RecoveryPanel, { mode: "restore", store: anyHost, status: ready, onStatus: noop, onClose: noop }));
    expect(restore.xs).toHaveLength(0);
    expect(restore.esc).toEqual([{ close: null, on: true, typing: false, side: false }]);
    // 直前の保存で開き直している間
    const prev = parts(h(PreviousPanel, { customerNo: "A0001", reason: "", info: { generation: 3, savedAt: null, savedBy: null }, busy: true, error: null, onOpen: noop, onClose: noop }));
    expect(prev.xs[0]?.props.disabled).toBe(true);
    expect(prev.esc[0]?.close).toBeNull();
  });

  it("書きかけの物（取り込みの確認）を開いている間は、Esc で閉じない（下の「事前ヒアリング・取り込む」にも渡さない）", () => {
    const view = { definition: { title: "事前ヒアリング", version: "1" }, candidates: [], kept: [], gates: [], issues: [] };
    declared.list = [];
    try {
      renderToString(h(ReviewPanel, { wh: wh(), view: view as never, onSave: noop, onClose: noop }));
    } catch {
      // 中身の形は見ない（Esc の受け手は、描き始めに重ねる）
    }
    expect(declared.list[0]).toEqual({ close: null, on: true, typing: false, side: false });
  });
});

// ---- 前の形が残っていないこと（ソースの文字で見る） ----

function sources(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "generated") sources(p, out);
    } else if (/\.(tsx?|css)$/.test(n)) out.push(p);
  }
  return out;
}

describe("前の形の × と、物ごとの Esc の受け方が残っていない", () => {
  const files = sources(join(APP_DIR, "src")).map((p) => ({ p: p.slice(APP_DIR.length + 1), text: readFileSync(p, "utf8") }));

  it("四角い ×（.hh-x）・「閉じる ×」（.ev-close）・枠なしの ×（.dv-close）は、どこにも無い", () => {
    // 画面の確かめ用の印（data-dv-close）は残す
    for (const f of files) for (const old of [/hh-x/, /ev-close/, /(?<!data-)dv-close/]) expect(old.test(f.text), `${f.p}: ${String(old)}`).toBe(false);
  });

  it("丸い × の形（.x-btn）を決めるのは app.css の1か所だけ。× を描くのは CloseX だけ", () => {
    const shaped = files.filter((f) => f.p.endsWith(".css") && /(^|\})\s*\.x-btn\s*\{[^}]*border-radius/m.test(f.text)).map((f) => f.p);
    expect(shaped).toEqual([join("src", "styles", "app.css")]);
    const drawn = files.filter((f) => f.p.endsWith(".tsx") && /class="x-btn"/.test(f.text)).map((f) => f.p);
    expect(drawn).toEqual([join("src", "presentation", "CloseX.tsx")]);
  });

  it("中央のパネル・入力項目のパネル・右の引き出し・世帯の一覧・お知らせ・届いた書類の枠を描く部品は、どれも CloseX と useEscClose を使う", () => {
    const marks = [/class="rk-panel/, /class=(\{`|")ipanel[ $"]/, /class="drawer /, /class="card hh-panel"/, /class="nc" role="dialog"/, /class=\{`dv\$/];
    const overlays = files.filter((f) => f.p.endsWith(".tsx") && marks.some((m) => m.test(f.text)));
    expect(overlays.length).toBeGreaterThanOrEqual(20);
    for (const f of overlays) {
      expect(/useEscClose\(/.test(f.text), `${f.p}: useEscClose`).toBe(true);
      expect(/<CloseX /.test(f.text), `${f.p}: CloseX`).toBe(true);
    }
  });

  it("重ねて出す物の部品は、Esc を document で直に受けない（重ねた順を通す）", () => {
    const direct = /addEventListener\("keydown"/;
    const own = files.filter((f) => f.p.endsWith(".tsx") && /useEscClose\(/.test(f.text) && f.p !== join("src", "presentation", "CloseX.tsx") && direct.test(f.text)).map((f) => f.p);
    expect(own).toEqual([]);
  });
});
