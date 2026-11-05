// お客さまの画面（0125。app/src/hearingForm/Form.tsx）: 最初の画面・問いの画面・書類の画面・確かめの画面の中身（見本の形で文字に描く）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { HearingForm } from "../src/hearingForm/Form.tsx";
import { draftKey, initialDraft, screenId, screens } from "../../hearing/src/web/flow.ts";
import { DOCUMENT_TEMPLATES } from "../../hearing/src/web/documents.ts";
import { officeFace, previewPacket, templateSelection, documentFromTemplate } from "../src/workspace/hearing/web.ts";
import { blankHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";

const NOW = new Date("2026-11-05T09:00:00Z");
let n = 0;
const wh = withRefreshedEstimates(blankHousehold("2026-11", () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`));
const office = officeFace({ name: "【架空】みらいFP事務所", color: "#2f6f5e", purpose: "ライフプランの作成のため", privacyContact: "【架空】窓口" });

async function packet() {
  const sel0 = templateSelection("first", wh);
  return previewPacket(wh, { ...sel0, documents: [documentFromTemplate(sel0, "withholding")] }, office, 14, NOW);
}

describe("お客さまの画面", () => {
  it("最初の画面: 事務所の名前・何のための問いか・名前を書かない・聞かないこと・期限・窓口。見本の印", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p) }));
    for (const t of ["【架空】みらいFP事務所", "ライフプランの作成のためにお聞きします", "お名前は書かないでください", "マイナンバー", "回答の期限", "【架空】窓口", "見本です", "はじめる"]) expect(html).toContain(t);
    // 事務所の色は CSS の変数で（style の属性に色の値だけ）
    expect(html).toContain("--hf-accent:#2f6f5e");
  });

  it("問いの画面: 金額の単位・記入例・わからない・あとで・だいたいの範囲。生年月は年（和暦つき）と月", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), gates: { spouse: 1, child: 0 } };
    const income = screenId(screens(p, d).find((s) => s.kind === "item" && s.key === "hs.income.annual")!);
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: income }));
    for (const t of ["年収", "万円", "1年あたり", "わからない", "あとで", "だいたいの範囲", "次へ", "戻る"]) expect(html).toContain(t);
    const birth = screenId(screens(p, d).find((s) => s.kind === "item" && s.key === "hs.family.adult.birthYearMonth")!);
    const html2 = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: birth }));
    expect(html2).toContain("1986年（昭和61年）");
    // 配偶者の方がいるかは分岐の問いで聞くので、生年月に「当てはまらない」は出さない
    expect(html2).not.toContain("当てはまらない");
  });

  it("書類の画面: 撮る前の注意（マイナンバーを隠す）・撮る・ファイルを選ぶ・手元にない・あとで送る・説明", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), startAt: "documents" }));
    for (const t of ["送っていただきたい書類", "撮る前に", "マイナンバー（個人番号）", "撮る", "ファイルを選ぶ", "手元にない", "あとで送る", DOCUMENT_TEMPLATES[0]!.purpose]) expect(html).toContain(t);
    expect(html).toContain('accept="image/jpeg,image/png,image/heic,image/heif,application/pdf"');
    expect(html).not.toContain("svg+xml");
  });

  it("確かめの画面: 答え・まだの数・直す・送る", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.housing.type")]: { status: "value" as const, raw: { kind: "text" as const, text: "rent" } } } };
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: "review" }));
    for (const t of ["お答えの確かめ", "賃貸", "直す", "この内容で送る", "まだの問いが"]) expect(html).toContain(t);
  });
});
