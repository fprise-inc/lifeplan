// AI 経由の不具合の報告を送る（0259）: 送る報告の確認画面の中身・名前と金額らしい所の印・写す文・送り方（URL に本文を入れない・via=ai）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FEEDBACK_FORM } from "../src/generated/distribution.ts";
import { feedbackFormUrl } from "../src/workspace/notices/receipts.ts";
import { canSend, composeReport, itemFromAi, markedParts, reportMarks, REPORT_SCREENS, screenChoice, sendReport, type ReportDraft, type ReportItem, type ReportMarkKind } from "../src/workspace/notices/reportSend.ts";
import { AiIssueReportBand, ReportConfirm } from "../src/workspace/notices/ReportConfirm.tsx";

const noop = () => undefined;
const kinds = (text: string) => reportMarks(text).map((m) => [m.kind, m.text] as [ReportMarkKind, string]);

/** draft_issue_report が返すような報告の文（見本の世帯の値だけ） */
const AI_TEXT = [
  "【ファイナンシアの不具合の報告】",
  "アプリの版: 0.1.0",
  "何が起きたか: 結果のタブで、2041年（15年目）の金融資産が前の年より大きく減った",
  "場所: 画面 結果・行 金融資産残高・2041年（15年目）",
  "期待した値: 前の年と同じくらい",
  "AI の見立て: 入力が原因（ここを直せば戻る）",
  "根拠:",
  "- check_inputs: 退職金の受け取りの年が空",
  "再現の手順（見本の世帯で）:",
  "1. 見本の世帯「会社員の夫婦と子ども2人」（salariedCoupleTwoKids）を開く",
  "2. 本人の退職の年齢を 60歳にする",
  "見本での再現: できた",
  "エラーの記録:",
  "- 2026-11-20 10:03・版 0.1.0・macOS・結果・計算・計算できなかった: E_HOST_MEMORY（2回）",
  "この報告には、お客さまの名前・生年月日・実際の金額・世帯を識別する値（共有の ID・顧客番号など）を入れていません。",
].join("\n");

describe("名前・金額らしい所の印（0259）", () => {
  it("ふつうの報告の文（見出し・年・年齢・版・見本の id・エラーの記録の日時）には印を付けない", () => {
    expect(kinds(AI_TEXT)).toEqual([]);
  });

  it("ふつうの言葉・建物の名前には印を付けすぎない", () => {
    for (const t of [
      "不動産屋さんに聞いた家賃で入れました",
      "お客様の奥さんとご主人様、お子さまの分",
      "大家さん・銀行さん・税理士さん・担当者さん・部長さん",
      "グランドメゾン渋谷の302号室に住む世帯",
      "パークタワー勝どきの管理費",
      "同様に、仕様書の様式どおり。多様な働き方。諸君、両氏",
      "東京都の世帯で計算すると区分が変わる",
      "65歳・2035年（10年目）・3人・12か月・第1子",
      "アプリの版: 0.1.0・形式 0.91・E_HOST_MEMORY",
      "見本の世帯 salariedCoupleTwoKids を開く",
    ]) {
      expect(kinds(t), t).toEqual([]);
    }
  });

  it("名前らしい所（敬称・名前の欄・全角の空白で区切った名前）", () => {
    expect(kinds("担当の山田さんから聞いた")).toEqual([["name", "山田さん"]]);
    expect(kinds("佐藤様の世帯")).toEqual([["name", "佐藤様"]]);
    expect(kinds("林さん")).toEqual([["name", "林さん"]]);
    expect(kinds("ヤマダさんの家計")).toEqual([["name", "ヤマダさん"]]);
    expect(kinds("お名前: 鈴木一郎")).toEqual([["name", "鈴木一郎"]]);
    expect(kinds("山田\u3000太郎の世帯")).toEqual([["name", "山田\u3000太郎"]]);
  });

  it("金額らしい所（〇〇万円・円・¥・漢数字）と数字の並び", () => {
    expect(kinds("前の年より 800万円 少ない")).toEqual([["money", "800万円"]]);
    expect(kinds("年収は1,234,567円")).toEqual([["money", "1,234,567円"]]);
    expect(kinds("預金は三百万円")).toEqual([["money", "三百万円"]]);
    expect(kinds("¥12,000 の保険料")).toEqual([["money", "¥12,000"]]);
    expect(kinds("金融資産が1.5億")).toEqual([["money", "1.5億"]]);
    expect(kinds("年金は 2,400 で")).toEqual([["digits", "2,400"]]);
    expect(kinds("顧客番号 123456")).toEqual([["digits", "123456"]]);
    // 4桁までの数（年・年齢・件数）は数字の並びにしない
    expect(kinds("2041年に 3回")).toEqual([]);
  });

  it("電話番号・メールアドレス・住所の形・生年月日らしい日付には印を付ける", () => {
    expect(kinds("連絡先 090-1234-5678")).toEqual([["phone", "090-1234-5678"]]);
    expect(kinds("03-1234-5678 まで")).toEqual([["phone", "03-1234-5678"]]);
    expect(kinds("09012345678")).toEqual([["phone", "09012345678"]]);
    expect(kinds("taro.yamada@example.co.jp に返事")).toEqual([["email", "taro.yamada@example.co.jp"]]);
    expect(kinds("〒305-0031")).toEqual([["address", "〒305-0031"]]);
    expect(kinds("東京都千代田区丸の内1丁目")).toEqual([["address", "東京都千代田区丸の内1丁目"]]);
    expect(kinds("茨城県つくば市竹園1-2-3に住む")).toEqual([["address", "茨城県つくば市竹園1-2-3"]]);
    expect(kinds("竹園3丁目5番地")).toEqual([["address", "3丁目5番地"]]);
    expect(kinds("生まれは1985年4月12日")).toEqual([["date", "1985年4月12日"]]);
    expect(kinds("1990-12-03 生まれ")).toEqual([["date", "1990-12-03"]]);
    expect(kinds("昭和60年4月12日")).toEqual([["date", "昭和60年4月12日"]]);
  });

  it("印の所と印でない所に分けて、元の文に戻せる", () => {
    const t = "山田さんの年収は 800万円 です";
    const parts = markedParts(t, reportMarks(t));
    expect(parts.map((p) => p.text).join("")).toBe(t);
    expect(parts.filter((p) => p.mark !== null).map((p) => p.mark?.kind)).toEqual(["name", "money"]);
  });
});

describe("どの画面のことか（受け付けのフォームの選択肢）", () => {
  it("選択肢はフォームと同じ9つ", () => {
    expect([...REPORT_SCREENS]).toEqual(["入力", "結果", "資産と負債", "万一のとき", "提案書", "事務所の設定・保存", "AI 接続", "URL で答えるヒアリング", "その他・分からない"]);
  });
  it("AI が書いた言葉を選択肢に寄せる（当たらなければ「その他・分からない」）", () => {
    expect(screenChoice("結果")).toBe("結果");
    expect(screenChoice("結果のタブ（キャッシュフロー表）")).toBe("結果");
    expect(screenChoice("入力のタブ")).toBe("入力");
    expect(screenChoice("資産と負債")).toBe("資産と負債");
    expect(screenChoice("AI接続")).toBe("AI 接続");
    expect(screenChoice("Web のヒアリング")).toBe("URL で答えるヒアリング");
    expect(screenChoice("")).toBe("その他・分からない");
    expect(screenChoice(null)).toBe("その他・分からない");
    expect(screenChoice("よく分からない所")).toBe("その他・分からない");
  });
});

const BUG: ReportItem = { kind: "bug", screen: "結果", text: AI_TEXT };
const REQUEST: ReportItem = { kind: "request", screen: "入力", text: "住宅ローンの繰上げ返済を年ごとに何回か入れたい" };
const QUESTION: ReportItem = { kind: "question", screen: "提案書", text: "表紙の色は変えられますか" };
const draft = (over: Partial<ReportDraft> = {}): ReportDraft => ({ code: "R-7K2Q", items: [BUG, REQUEST, QUESTION], appVersion: "0.1.0", os: "macOS", viaAi: true, ...over });

describe("AI が書いた件をそろえる", () => {
  it("知らない種類は不具合、画面は選択肢に寄せる", () => {
    expect(itemFromAi({ kind: "request", screen: "入力のタブ", text: "x" })).toEqual({ kind: "request", screen: "入力", text: "x" });
    expect(itemFromAi({ kind: "other", screen: null, text: "y" })).toEqual({ kind: "bug", screen: "その他・分からない", text: "y" });
  });
});

describe("送り方（1か所。0259）", () => {
  it("写す文は1つ: 頭に受付番号・版と OS・件数、件ごとに番号・種類・どの画面かの見出し", () => {
    const t = composeReport(draft());
    expect(t.split("\n").slice(0, 3)).toEqual(["受付番号: R-7K2Q", "アプリの版: 0.1.0（macOS）", "件数: 3件（AI がまとめ、FP が確かめて送りました）"]);
    expect(t).toContain("━━ 1件目／3件（不具合）どの画面か: 結果 ━━\n【ファイナンシアの不具合の報告】");
    expect(t).toContain("━━ 2件目／3件（要望）どの画面か: 入力 ━━\n住宅ローンの繰上げ返済を年ごとに何回か入れたい");
    expect(t).toContain("━━ 3件目／3件（質問）どの画面か: 提案書 ━━\n表紙の色は変えられますか");
    expect(t.indexOf("1件目")).toBeLessThan(t.indexOf("2件目"));
    expect(composeReport(draft({ viaAi: false, items: [{ ...REQUEST, text: "  要望です  " }] })).split("\n")).toEqual(["受付番号: R-7K2Q", "アプリの版: 0.1.0（macOS）", "件数: 1件", "", "━━ 1件目／1件（要望）どの画面か: 入力 ━━", "要望です"]);
  });

  it("送る1回で、全件を1つの文にまとめて写し、受付番号を覚えて、via=ai を付けてフォームを1回だけ開く。開く URL に本文は入らない", async () => {
    const copied: string[] = [];
    const opened: string[] = [];
    const remembered: string[] = [];
    const r = await sendReport(draft(), {
      copy: async (t) => (copied.push(t), true),
      openForm: async (code, via) => void opened.push(feedbackFormUrl(FEEDBACK_FORM, { code, appVersion: "0.1.0", os: "macOS", via })),
      remember: (x) => remembered.push(x.code),
      today: () => "2026-11-24",
    });
    expect(r).toMatchObject({ copied: true, opened: true });
    expect(copied).toEqual([composeReport(draft())]);
    expect(remembered).toEqual(["R-7K2Q"]);
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]!);
    expect(url.searchParams.get("via")).toBe("ai");
    expect(url.searchParams.get("no")).toBe("R-7K2Q");
    expect([...url.searchParams.keys()].sort()).toEqual(["no", "os", "ver", "via"]);
    // 本文のどの行も URL に入っていない
    for (const it of draft().items) for (const line of it.text.split("\n")) expect(decodeURIComponent(opened[0]!)).not.toContain(line);
    expect(opened[0]!.length).toBeLessThan(120);
  });

  it("FP が書いた報告は via を付けない。写せなくてもフォームは開き、文を返す。開けなければ opened が false", async () => {
    const vias: (string | undefined)[] = [];
    const r = await sendReport(draft({ viaAi: false }), { copy: async () => false, openForm: async (_c, via) => void vias.push(via), remember: noop, today: () => "2026-11-24" });
    expect(vias).toEqual([undefined]);
    expect(r.copied).toBe(false);
    expect(r.text).toContain(AI_TEXT);
    const r2 = await sendReport(draft(), { copy: () => Promise.reject(new Error("x")), openForm: () => Promise.reject(new Error("E_FEEDBACK_OPEN")), remember: noop, today: () => "2026-11-24" });
    expect(r2).toMatchObject({ copied: false, opened: false });
  });

  it("空の報告・空の件は送れない（写さない・開かない・覚えない）", async () => {
    expect(canSend([])).toBe(false);
    expect(canSend([{ ...BUG, text: " \n\t " }])).toBe(false);
    expect(canSend([BUG, { ...REQUEST, text: "" }])).toBe(false);
    expect(canSend([BUG])).toBe(true);
    let called = 0;
    const deps = { copy: async () => (called++, true), openForm: async () => void called++, remember: () => void called++, today: () => "2026-11-24" };
    await expect(sendReport(draft({ items: [] }), deps)).rejects.toThrow("E_REPORT_EMPTY");
    await expect(sendReport(draft({ items: [BUG, { ...QUESTION, text: "  \n " }] }), deps)).rejects.toThrow("E_REPORT_EMPTY");
    expect(called).toBe(0);
  });

  it("via=ai はひな形の形（? の有無・# の後ろ）によらず決まった形で足す", () => {
    expect(feedbackFormUrl("https://example.com/f?no={受付番号}", { code: "R-7K2Q", appVersion: "0.1.0", os: "macOS", via: "ai" })).toBe("https://example.com/f?no=R-7K2Q&via=ai");
    expect(feedbackFormUrl("https://example.com/f#no={受付番号}", { code: "R-7K2Q", appVersion: "0.1.0", os: "macOS", via: "ai" })).toBe("https://example.com/f?via=ai#no=R-7K2Q");
    expect(feedbackFormUrl("https://example.com/f?no={受付番号}", { code: "R-7K2Q", appVersion: "0.1.0", os: "macOS" })).toBe("https://example.com/f?no=R-7K2Q");
    // 配布元の設定のフォーム（受け付けのフォーム。隠れた欄 no・ver・os・via）にも、同じ形で足せる
    const url = new URL(feedbackFormUrl(FEEDBACK_FORM, { code: "R-7K2Q", appVersion: "0.1.0", os: "macOS", via: "ai" }));
    expect([...url.searchParams.entries()]).toEqual([
      ["no", "R-7K2Q"],
      ["ver", "0.1.0"],
      ["os", "macOS"],
      ["via", "ai"],
    ]);
  });
});

describe("送る報告の確認画面（0259）", () => {
  const props = { code: "R-7K2Q", appVersion: "0.1.0", os: "macOS", onSend: async () => ({ text: "", copied: true, opened: true }), onClose: noop };

  it("件の一覧（件ごとに種類・どの画面か・内容と外す）・アプリの版・OS・受付番号と、世帯の情報が入っていないことを確かめる文を出す", () => {
    const html = renderToString(h(ReportConfirm, { ...props, source: "ai", initialItems: [BUG, REQUEST, QUESTION], connector: "Claude 1.0", onDiscard: async () => undefined }));
    expect(html).toContain("送る報告の確認画面");
    expect(html).toContain("お客さまの名前・金額など世帯の情報が入っていないことを確かめてください");
    expect(html).toContain('data-report-count="3"');
    expect((html.match(/data-report-item=/g) ?? []).length).toBe(3);
    expect((html.match(/data-report-remove/g) ?? []).length).toBe(3);
    expect((html.match(/data-report-text/g) ?? []).length).toBe(3);
    expect(html).toContain("1件目");
    expect(html).toContain("3件目");
    expect(html).toContain("【ファイナンシアの不具合の報告】");
    expect(html).toMatch(/<option[^>]*value="request"[^>]*selected[^>]*>要望/);
    expect(html).toMatch(/<option[^>]*value="提案書"[^>]*selected/);
    expect(html).toContain("0.1.0");
    expect(html).toContain("macOS");
    expect(html).toContain("R-7K2Q");
    expect(html).toContain("AI がまとめた報告");
    expect(html).toContain("3件に分けてあります");
    expect(html).toContain("Claude 1.0");
    expect(html).toContain("送る（3件）");
    expect(html).toContain("data-report-discard");
    // 送る前に、全件を1つの文にまとめて写し、フォームを1回だけ開くこと、文は URL に入れないこと、貼り付け方を伝える
    expect(html).toContain("フォームを1回だけ開きます");
    expect(html).toContain("URL には入れません");
    expect(html).toContain("Ctrl+V / ⌘V");
    // 印の無い件では、印の一覧を出さない
    expect((html.match(/data-report-marks-none/g) ?? []).length).toBe(3);
    expect(html).not.toContain("data-report-mark=");
  });

  it("名前・金額らしい所に件ごとに印を付けて知らせる（送るのは止めない）", () => {
    const html = renderToString(h(ReportConfirm, { ...props, source: "ai", initialItems: [{ kind: "bug", screen: "結果", text: "山田さんの世帯で 800万円 が消えた。連絡は 090-1234-5678" }, REQUEST, { kind: "request", screen: "入力", text: "佐藤様の家計で使いたい" }], onDiscard: async () => undefined }));
    expect(html).toContain('data-report-marks="3"');
    expect(html).toContain('data-report-marks="1"');
    expect(html).toContain("気になる所が3か所あります");
    expect(html).toContain("気になる所が1か所あります");
    expect(html).toContain('data-report-marks-total="4"');
    expect(html).toContain('data-report-mark="name"');
    expect(html).toContain('data-report-mark="money"');
    expect(html).toContain('data-report-mark="phone"');
    expect(html).toContain("名前らしい");
    expect(html).toContain("金額らしい");
    expect(html).toMatch(/<mark[^>]*>山田さん<\/mark>/);
    expect(html).toMatch(/<mark[^>]*>佐藤様<\/mark>/);
    expect(html).not.toMatch(/data-report-send[^>]*disabled/);
  });

  it("FP が書く報告は空の1件から始め、空のうちは送れない（AI の印・捨てるは出さない）。件を足せる", () => {
    const html = renderToString(h(ReportConfirm, { ...props, source: "fp", initialItems: [{ kind: "bug", screen: "その他・分からない", text: "" }] }));
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-report-send|<button[^>]*data-report-send[^>]*disabled/);
    expect(html).toContain("内容が空の件があります");
    expect(html).not.toContain("AI がまとめた報告");
    expect(html).not.toContain("data-report-discard");
    expect(html).toContain("data-report-add");
    // 件が無いときも送れない
    const none = renderToString(h(ReportConfirm, { ...props, source: "fp", initialItems: [] }));
    expect(none).toMatch(/<button[^>]*disabled[^>]*data-report-send|<button[^>]*data-report-send[^>]*disabled/);
    expect(none).toContain("data-report-no-items");
  });

  it("上の帯は届いている数と開くボタンだけ（中身は出さない）", () => {
    expect(renderToString(h(AiIssueReportBand, { count: 0, onOpen: noop }))).toBe("");
    const html = renderToString(h(AiIssueReportBand, { count: 2, onOpen: noop }));
    expect(html).toContain("AIから、送る報告が届いています（2回分）");
    expect(html).toContain("data-ai-issue-report-band-open");
  });

  it("「要望・不具合を送る」から、FP が書いて同じ確認画面を通れる", () => {
    const src = readFileSync(join(import.meta.dirname, "../src/workspace/notices/FeedbackPanel.tsx"), "utf8");
    expect(src).toContain("報告の文を書いて送る");
    expect(src).toContain("data-feedback-write");
  });
});
