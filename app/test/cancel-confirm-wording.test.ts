// 取り消しのボタンのまわり（0243）: 言葉（「キャンセル」「やめる」）は1つにそろえない。直したのは次の所。
// - 確かめの文が無く、ボタンだけが並んでいた所（控えの一覧・面談の履歴・明細の口座と取り込んだ明細）: 文を出し、確かめの間は関係ないボタンを出さない
// - 2つの言葉がくっついて読めた所（コードを外す・公式に戻す・ひな形を選び直す）: 文と2つのボタンを分ける
// - 入力・設定の途中をやめる所は「キャンセル」（コードを入れる・推定の値・確かめの表の値を直す・明細の取り込み・確認シート）
// - 進むボタンが左・取り消しが右
// 押した後の形は、描いている途中で押して見る（pressing.ts）。読み込みの後にしか出ない所（明細を読んだ後など）は、ソースの文字で見る
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { describe, expect, it } from "vitest";
import { APP_DIR, REPO_DIR } from "../scripts/lib.ts";
import type { FeatureStatus } from "../src/engine/host.ts";
import { CANCEL_ASK_TEXT, templateSelection } from "../src/workspace/hearing/web.ts";
import { WebBuilder } from "../src/workspace/hearing/WebBuilder.tsx";
import type { HearingTemplate } from "../src/workspace/hearing/selection.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { MeetingTools } from "../src/workspace/meetings/MeetingTools.tsx";
import { withMeetings } from "../src/workspace/meetings/meetings.ts";
import { EMPTY_ESTIMATES } from "../src/workspace/office/estimates.ts";
import { EstimatesSection } from "../src/workspace/office/EstimatesSection.tsx";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import { ReviewTable } from "../src/workspace/review/ReviewTable.tsx";
import type { ReviewRow } from "../src/workspace/review/rows.ts";
import { SnapshotTools } from "../src/workspace/snapshots/SnapshotTools.tsx";
import type { Snapshot } from "../src/workspace/snapshots/snapshots.ts";
import { addAccount, addImport, logOf, readFile, withLog } from "../src/workspace/statement/model.ts";
import { AccountsStep, ImportStep } from "../src/workspace/statement/StatementPanel.tsx";
import { modelHousehold } from "./helpers.ts";
import { markedMeetings } from "./meetingsFixture.ts";
import { buttonTexts, renderPressing, within } from "./pressing.ts";

const noop = () => undefined;
const wh = () => fromRequest(modelHousehold("salariedCoupleTwoKids"));
const src = (...p: string[]) => readFileSync(join(APP_DIR, "src", ...p), "utf8");
const anyHost = new Proxy({}, { get: () => async () => null }) as never;

describe("確かめの文を出し、確かめの間は関係ないボタンを出さない", () => {
  it("控えの一覧の「外す」: 文と「外す／キャンセル」（控えは元に戻すの対象でないので「元に戻せません」）", () => {
    const list = [{ id: "s1", createdAt: "2026-11-01T10:00:00.000Z", trigger: "manual", memo: "1回目の面談の後", plan: null }] as unknown as Snapshot[];
    const props = { list, stored: true, onTake: async () => undefined, onRemove: noop, bar: false, mode: "list" as const, onMode: noop };
    const ask = within(renderPressing(h(SnapshotTools, props), "data-snapshot-remove"), "data-snapshot-remove-ask");
    expect(ask).toContain("この控えを外しますか（元に戻せません）");
    expect(buttonTexts(ask)).toEqual(["外す", "キャンセル"]);
    expect(ask).toMatch(/class="link-btn danger"[^>]*>外す/);
    // キャンセルで元の並び
    const back = renderPressing(h(SnapshotTools, props), "data-snapshot-remove", "data-snapshot-remove-cancel");
    expect(back).not.toContain("data-snapshot-remove-ask");
    expect(back).toContain("data-snapshot-remove");
    // 一覧を閉じたら確かめも閉じる（開き直したときに残さない）
    expect(src("workspace", "snapshots", "SnapshotTools.tsx")).toMatch(/if \(mode !== "list"\) setRemoving\(null\)/);
  });

  it("面談の履歴の開いた記録の「外す」: 文と「外す／キャンセル」だけ（直す・一覧へ戻るは出さない）。文は外した後の知らせと同じ「元に戻すで戻せます」", () => {
    const props = { wh: withMeetings(wh(), markedMeetings()), onSave: noop, onClose: noop, result: null, onOpen: noop, focus: { id: "m-1", n: 1 } };
    const html = renderPressing(h(MeetingTools, props), "data-meeting-remove");
    const ask = within(html, "data-meeting-remove-ask");
    expect(ask).toContain("この面談の記録を外しますか（元に戻すで戻せます）");
    expect(buttonTexts(ask)).toEqual(["外す", "キャンセル"]);
    expect(ask).toMatch(/class="btn danger"[^>]*>外す/);
    expect(buttonTexts(within(html, 'class="mt-record"'))).toEqual(["外す", "キャンセル"]);
    expect(src("workspace", "meetings", "MeetingTools.tsx")).toContain("面談の記録を外しました（元に戻すで戻せます）");
    // キャンセルで元の並び
    const back = renderPressing(h(MeetingTools, props), "data-meeting-remove", "data-meeting-remove-cancel");
    expect(buttonTexts(within(back, 'class="mt-record"'))).toEqual(["直す", "外す", "一覧へ戻る"]);
    // 確かめは記録ごと（ほかの記録を開いたときに付かない）
    expect(src("workspace", "meetings", "MeetingTools.tsx")).toMatch(/removing === m\.id/);
  });

  it("明細の口座・カードの「外す」と、取り込んだ明細の「外す」: 文と「外す／やめる」（明細の記録は元に戻すの対象でないので「元に戻せません」）", async () => {
    const base = wh();
    const accounts = addAccount(addAccount(logOf(base), { kind: "card", label: "家計のカード", owner: null }, "acc-1"), { kind: "card", label: "もう1枚のカード", owner: null }, "acc-2");
    // 明細のパネルは事務所の辞書を読んでから中身を出すので、中の段（口座・カード、明細の取り込み）を直に描く
    const panel = (log: typeof accounts, step: "accounts" | "import") =>
      step === "accounts"
        ? h(AccountsStep, { wh: withLog(base, log), log, onLog: noop, onNext: noop })
        : h(ImportStep, { wh: withLog(base, log), log, office: { dictionary: [], formats: [] }, host: anyHost, readers: [], onLog: noop, onOffice: noop, onNext: noop, onAccounts: noop });
    // 明細の無い口座
    const row = within(renderPressing(panel(accounts, "accounts"), "data-statement-account-remove"), 'class="st-acc-act"');
    expect(row).toContain("この口座・カードを外しますか（元に戻せません）");
    expect(buttonTexts(row)).toEqual(["外す", "やめる"]);
    expect(row).toMatch(/class="btn small danger"[^>]*>外す/);
    // 明細を取り込んだ口座は、いっしょに外す件数も書く
    const out = await readFile(new Uint8Array(readFileSync(join(REPO_DIR, "statement", "test", "fixtures", "card-year-utf8bom.csv"))), "card", []);
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    const added = addImport(accounts, out, { id: "imp-1", account: "acc-1", at: "2026-10-23T10:00:00+09:00" });
    if (!added.ok) throw new Error(added.reason);
    expect(renderPressing(panel(added.log, "accounts"), "data-statement-account-remove")).toContain("この口座・カードを外しますか（取り込んだ明細 1件もいっしょに外します。元に戻せません）");
    // 取り込んだ明細
    const ask = within(renderPressing(panel(added.log, "import"), "data-statement-import-remove"), "data-statement-import-remove-ask");
    expect(ask).toContain("この明細を外しますか（元に戻せません）");
    expect(buttonTexts(ask)).toEqual(["外す", "やめる"]);
    // やめるで元の並び
    expect(buttonTexts(within(renderPressing(panel(accounts, "accounts"), "data-statement-account-remove", "data-statement-account-remove-cancel"), 'class="st-acc-act"'))).toEqual(["直す", "外す"]);
    expect(renderPressing(panel(added.log, "import"), "data-statement-import-remove", "data-statement-import-remove-cancel")).not.toContain("data-statement-import-remove-ask");
  });
});

describe("文と2つのボタンを分ける（くっついて「外すやめる」と読めない）", () => {
  const features: FeatureStatus = { today: "2026-11-22", active: ["combinedBs"], codes: [{ ref: "r1", id: "FC-0001", name: "見本FP事務所", features: ["combinedBs"], issued: "2026-11-01", expires: "2027-10-31", state: "active", daysLeft: 343, notice: false, noticeSince: null }] as never, invalid: [] };
  const office = { value: DEFAULT_OFFICE_SETTINGS, onSave: async () => undefined, shared: false, onClose: noop, features, onRemoveCode: async () => features };

  it("事務所の既定値の「コードを外す」: 文は文、ボタンは2つ一緒の枠（外すは危ない色・やめるが右）", () => {
    const ask = within(renderPressing(h(OfficeSettingsPanel, office), "data-feature-remove-ask"), "data-feature-remove-confirm");
    expect(ask).toMatch(/^<p class="rp-note os-ask"[^>]*><span>外すと、[^<]*<\/span><span class="os-ask-acts"><button/);
    expect(buttonTexts(ask)).toEqual(["外す", "やめる"]);
    expect(ask).toMatch(/class="link-btn danger"[^>]*>外す/);
    // やめるで元の並び（「コードを外す」が戻る）
    const back = renderPressing(h(OfficeSettingsPanel, office), "data-feature-remove-ask", "data-feature-remove-cancel");
    expect(back).not.toContain("data-feature-remove-confirm");
    expect(back).toContain("data-feature-remove-ask");
  });

  it("ボタンどうし・文とボタンの間を空ける決まり（CSS）", () => {
    const app = src("styles", "app.css");
    expect(app).toMatch(/\.os-ask \{[^}]*display: flex;[^}]*gap: 4px 12px;/);
    expect(app).toMatch(/\.os-ask-acts \{[^}]*display: inline-flex;[^}]*gap: 12px;[^}]*white-space: nowrap;/);
    const web = src("styles", "hearingWeb.css");
    expect(web).toMatch(/\.wr-confirm \{[^}]*display: flex;[^}]*gap: 4px 8px;/);
    expect(web).toMatch(/\.wr-confirm-acts \{[^}]*display: inline-flex;[^}]*gap: 8px;/);
    expect(src("styles", "statement.css")).toMatch(/\.st-ask-acts \{[^}]*display: inline-flex;[^}]*gap: 6px;/);
    expect(src("styles", "wire.css")).toMatch(/\.snap-confirm \{[^}]*display: flex;[^}]*gap: 4px 10px;/);
  });

  it("URL生成のひな形を切り替える確かめ（追記 2026-11-23）: 切り替え先の名前と消える物を書き、「切り替える／キャンセル」（項目を選んでいる途中をやめる物なのでキャンセル）", () => {
    const base = wh();
    const saved = { name: "子育て世帯の最初の面談", selection: templateSelection("simple", base) } as unknown as HearingTemplate;
    const props = { wh: base, web: anyHost, office: { name: "", color: null }, templates: [saved], onTemplates: async () => undefined, customerNo: "B0007", persisted: true, onSave: noop, saveNow: async () => true, onClose: noop };
    // 分野の並びを変えて（項目を直した状態にして）から、詳細を選ぶ
    const ask = within(renderPressing(h(WebBuilder, props), "aria-label=ご家族を下へ", "data-web-template=detail"), "data-web-template-ask");
    expect(ask).toMatch(/<span>「詳細」に切り替えると、項目に加えた変更は消えます（書類・独自の質問は残ります）。<\/span><span class="wr-confirm-acts">/);
    expect(buttonTexts(ask)).toEqual(["切り替える", "キャンセル"]);
    expect(ask).not.toMatch(/選んだひな形|戻ります|よろしいですか/);
    // 保存したカスタム: 項目を直したとき
    expect(within(renderPressing(h(WebBuilder, props), "aria-label=ご家族を下へ", "data-web-template=t:0"), "data-web-template-ask")).toContain(
      "「子育て世帯の最初の面談」に切り替えると、項目に加えた変更は消えます（「子育て世帯の最初の面談」の項目・書類・独自の質問になります）。",
    );
    // 保存したカスタム: 項目は直さず、書類を頼んでいるとき
    expect(within(renderPressing(h(WebBuilder, props), "data-web-doc-add=withholding", "data-web-template=t:0"), "data-web-template-ask")).toContain(
      "「子育て世帯の最初の面談」に切り替えると、今の書類・独自の質問は消えます（「子育て世帯の最初の面談」の項目・書類・独自の質問になります）。",
    );
    // 両方
    expect(within(renderPressing(h(WebBuilder, props), "data-web-doc-add=withholding", "aria-label=ご家族を下へ", "data-web-template=t:0"), "data-web-template-ask")).toContain(
      "「子育て世帯の最初の面談」に切り替えると、項目に加えた変更と、今の書類・独自の質問は消えます（",
    );
    // キャンセルで確かめが消える
    expect(renderPressing(h(WebBuilder, props), "aria-label=ご家族を下へ", "data-web-template=detail", "data-web-template-no")).not.toContain("data-web-template-ask");
  });
});

describe("入力・設定の途中をやめるのは「キャンセル」（進むボタンの右）", () => {
  it("事務所の既定値の「機能を有効にするコードを入れる」", () => {
    const html = renderPressing(h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, onSave: async () => undefined, shared: false, onClose: noop, onAddCode: async () => null as never }), "data-feature-code-open");
    expect(buttonTexts(within(html, 'class="os-code-form"'))).toEqual(["確かめて入れる", "キャンセル"]);
  });

  it("事務所の既定値の「推定の値」を変える所", () => {
    const html = renderPressing(h(EstimatesSection, { value: EMPTY_ESTIMATES, onChange: async () => undefined, today: () => "2026-11-22" }), "data-office-estimate-edit");
    expect(buttonTexts(within(html, 'class="os-est-actions"'))).toEqual(["この値にする", "キャンセル"]);
  });

  it("確かめの表で候補の値を直す所", () => {
    const row: ReviewRow = { id: "r1", group: "保険", label: "契約の表示名", current: { text: "なし", status: null }, incoming: { text: "医療保険", unreadable: false }, compare: null, source: { where: "1ページ", text: null }, confidence: "high", status: "pending", problem: null, correctable: true, structural: false, edit: { kind: "text", initial: "医療保険" } as never };
    const html = renderPressing(h(ReviewTable, { rows: [row], selected: null, onSelect: noop, onAccept: noop, onCorrect: () => null, onReject: noop }), "data-review-correct");
    expect(buttonTexts(within(html, "data-rv-edit"))).toEqual(["入れる", "キャンセル"]);
  });

  it("明細の取り込みの「取り込む（○行）」「承認して仕分けに入れる」と、確認シートを書き出す前の注意（ソースの文字で見る）", () => {
    const s = src("workspace", "statement", "StatementPanel.tsx");
    for (const [go, cancel] of [
      ["data-statement-take", "data-statement-take-cancel"],
      ["data-statement-sheet-go", "data-statement-sheet-cancel"],
      ["data-statement-marks-approve", "data-statement-marks-cancel"],
    ] as const) {
      // 進むボタンのすぐ後ろが取り消しのボタンで、言葉は「キャンセル」
      expect(s, cancel).toMatch(new RegExp(`${go}>[^<]*</button>\\s*<button type="button" class="btn" onClick=\\{[^}]*\\} ${cancel}>\\s*キャンセル\\s*</button>`));
    }
    // 同じ形の注意（提案書・持ち帰り用のレポートの保存の前）と同じ言葉
    expect(src("workspace", "report", "ReportTab.tsx")).toMatch(/わかりました。保存する\s*<\/button>\s*<button type="button" class="btn" onClick=\{\(\) => setWarn\(false\)\}>\s*キャンセル/);
  });
});

describe("「やめる」のままにする所（消す・外す・捨てる・取り消すの確かめと、3択の問い。利用者の判断）", () => {
  /** 「やめる」のボタンの数（ファイルごと。文字が「やめる」だけの行と、選ばせる問いの「やめる」） */
  const counts = () => {
    const out: Record<string, number> = {};
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) {
          const n = readFileSync(p, "utf8").split("\n").filter((l) => /^\s*やめる\s*$/.test(l) || /key: "cancel", label: "やめる"/.test(l)).length;
          if (n > 0) out[p.slice(join(APP_DIR, "src").length + 1)] = n;
        }
      }
    };
    walk(join(APP_DIR, "src"));
    return out;
  };

  it("「やめる」のボタンがあるのは、決めた所だけ（入力・設定の途中をやめるボタンを足すときは「キャンセル」にする）", () => {
    expect(counts()).toEqual({
      // お客さまの回答ページの「この端末の入力を消す」
      "hearingForm/Form.tsx": 1,
      // AI が発行した URL の「取り消す」
      "workspace/ai/AiHearingIssued.tsx": 1,
      // 書類の候補を「捨てる」
      "workspace/documents/DocumentReview.tsx": 1,
      // 受け取った書類の「消す」
      "workspace/hearing/ReceivedDocs.tsx": 1,
      // 発行した URL の「取り消す」「受け付けを終える」
      "workspace/hearing/WebRequests.tsx": 1,
      // 入力項目のパネルの「一緒に外す物」
      "workspace/input/InputPanel.tsx": 1,
      // 要望・不具合を送るの「すべて消す」
      "workspace/notices/FeedbackPanel.tsx": 1,
      // 説明の文（カスタム層）の「公式に戻す」
      "workspace/office/CustomTextsSection.tsx": 1,
      // 機能のコードを「外す」
      "workspace/office/OfficeSettingsPanel.tsx": 1,
      // プランを帯から外すとき・世帯を離れるときの3択の問い
      "workspace/plans/BandDropDialog.tsx": 2,
      "workspace/plans/DraftsLeaveDialog.tsx": 1,
      // 明細の口座・カードを「外す」、取り込んだ明細を「外す」、「同じ明細ではありませんか？」
      "workspace/statement/StatementPanel.tsx": 3,
      "workspace/store/LeaveDialog.tsx": 1,
    });
  });
});

describe("追記（2026-11-23）: 取り消しの確かめの文を短く・法人経営者向けの機能の説明", () => {
  it("発行した URL の確かめの文は1か所で短く（幅 1000px・文字「中」でボタンと1行）。回答が届いているとき・受け付けを終えるときも短く", () => {
    expect(CANCEL_ASK_TEXT).toBe("お客さまはこの URL を開けなくなります。取り消しますか。");
    const web = src("workspace", "hearing", "WebRequests.tsx");
    expect(web).toContain("CANCEL_ASK_TEXT");
    expect(web).toContain('"お客さまはこの URL を開けなくなり、届いた回答も消えます。取り消しますか。"');
    expect(web).toContain('"お客さまはこの URL を開けず、書類も届きません。受け付けを終えますか。"');
    expect(src("workspace", "ai", "AiHearingIssued.tsx")).toContain("<span>{CANCEL_ASK_TEXT}</span>");
    for (const f of [web, src("workspace", "ai", "AiHearingIssued.tsx")]) expect(f).not.toMatch(/途中の(回答|お答え)も送れません/);
  });

  it("法人経営者向けの機能の説明は「法人を顧問先に持つ FP 向け」（見出しと同じ「法人」）", () => {
    const html = renderPressing(h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, onSave: async () => undefined, shared: false, onClose: noop, features: { today: "2026-11-23", active: ["combinedBs"], codes: [], invalid: [] } }));
    expect(html).toContain("法人を顧問先に持つ FP 向けの機能です。");
    expect(html).not.toContain("会社を顧問先");
  });
});
