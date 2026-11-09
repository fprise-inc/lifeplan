// お客さまの画面（0125・0158。app/src/hearingForm/Form.tsx）: 最初の画面・問いの画面・書類の画面・確かめの画面・送った後・答えの後の書類の画面の中身（見本の形で文字に描く）
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
  const sel0 = templateSelection("simple", wh);
  return previewPacket(wh, { ...sel0, documents: [documentFromTemplate(sel0, "withholding")] }, office, NOW);
}

describe("お客さまの画面", () => {
  it("最初の画面: 事務所からのご質問・問いの数と所要時間・誰が開けるか・期限・名前を書かない・聞かないこと・窓口・このページの仕組み。見本の印", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), now: () => NOW }));
    for (const t of ["【架空】みらいFP事務所からのご質問です", "ライフプランの作成のためにお聞きします", "画面</b>ほど", "分</b>ほどで答えられます", "【架空】みらいFP事務所の担当の FP だけが開けます", "回答の期限", "お名前は書かないでください", "お名前がなくても", "途中まででも送れます", "マイナンバー", "【架空】窓口", "このページの仕組み", "提供元も、中身は読めない仕組みです", "見本です", "はじめる"]) expect(html).toContain(t);
    expect(html).not.toContain("番号でお客さまを見分けます");
    expect(html).not.toContain("当てはまらない問いは");
    // 事務所の色は CSS の変数で（style の属性に色の値だけ）
    expect(html).toContain("--hf-accent:#2f6f5e");
  });

  it("問いの画面: 働き方と年収を1画面に。年収は範囲が先で、くわしい額は開いて入れる。「働いていない」は1つだけ。進み具合は段の名前", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), gates: { spouse: 1, child: 0 } };
    const work = screenId(screens(p, d).find((s) => s.kind === "item" && s.key === "hs.work.type")!);
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: work, now: () => NOW }));
    for (const t of ["いまの働き方", "年収", "1年あたり・だいたいの範囲を選んでください", "500〜600万円", "くわしい額を入れる", "わからない", "あとで", "次へ", "戻る", "お仕事と収入"]) expect(html).toContain(t);
    expect(html.split("働いていない").length - 1).toBe(1);
    expect(html).not.toContain("当てはまらない");
    // 分母は出さない（段の印と名前）
    expect(html).not.toMatch(/\d+ \/ \d+/);
    // 生年月・年齢・性別は人ごとに1画面。年は15年前から、月は「わからない」も選べる
    const birth = screenId(screens(p, d).find((s) => s.kind === "item" && s.key === "hs.family.adult.birthYearMonth")!);
    const html2 = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: birth, now: () => NOW }));
    for (const t of ["生まれた年と月", "1986年（昭和61年）", "2011年（平成23年）", "わからない", "年齢（生まれた年月がわからないとき）", "性別", "男性"]) expect(html2).toContain(t);
    expect(html2).not.toContain("2012年（平成24年）");
    // 配偶者の方がいるかは分岐の問いで聞くので、生年月に「当てはまらない」は出さない
    expect(html2).not.toContain("当てはまらない");
  });

  it("分岐の問い: 配偶者の方とお子さまの人数を1画面に（いない／1人／2人…）", async () => {
    const p = await packet();
    const gate = screenId(screens(p, initialDraft(p)).find((s) => s.kind === "gate")!);
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), startAt: gate, now: () => NOW }));
    for (const t of ["配偶者の方", "いらっしゃる", "お子さまは何人", "いない", "1人", "2人"]) expect(html).toContain(t);
  });

  it("同意の画面: AI の文は、担当の FP が整理すること（お名前は渡さない）", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), startAt: "consent", now: () => NOW }));
    expect(html).toContain("担当の FP が、AI を使ってお答えを整理することがあります（お名前は渡しません）");
    expect(html).not.toContain("外部のAIサービス");
  });

  it("書類の画面: 撮る前の注意（マイナンバーを隠す）・撮る・ファイルを選ぶ・手元にない・あとで送る・説明", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), startAt: `doc:${p.documents[0]!.id}` }));
    for (const t of ["送っていただきたい書類", "撮る前に", "マイナンバー（個人番号）", "撮る", "ファイルを選ぶ", "手元にない", "あとで送る", DOCUMENT_TEMPLATES[0]!.purpose]) expect(html).toContain(t);
    expect(html).toContain('accept="image/jpeg,image/png,image/heic,image/heif,application/pdf"');
    expect(html).not.toContain("svg+xml");
  });

  it("確かめの画面: 答え・まだの数・途中まででも送れる・まだの問いに答える・直す・送る・この端末の入力を消す", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), started: true, gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.housing.type")]: { status: "value" as const, raw: { kind: "text" as const, text: "rent" } }, [draftKey("hs.housing.rent")]: { status: "value" as const, raw: { kind: "number" as const, text: "９８，０００" } } } };
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: "review", now: () => NOW }));
    for (const t of ["お答えの確かめ", "賃貸", "月 98,000円", "直す", "この内容で送る", "まだの問いが", "途中まででも送れます", "答えていない所は、面談のときにうかがいます", "まだの問いに答える", "この端末の入力を消す"]) expect(html).toContain(t);
  });

  it("送った後の画面: 届いた先と日時・あとで送る書類・送った内容を見る・印刷する", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), gates: { spouse: 0, child: 0 }, documents: { [p.documents[0]!.id]: { status: "later" as const, files: [] } } };
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: "sent", now: () => NOW }));
    for (const t of ["【架空】みらいFP事務所に届きました", "に送りました", "「あとで送る」にした書類", "届いたリンクを開き直して送ってください", "書類を続けて送る", "送った内容を見る", "印刷する", "閉じる前に印刷してください", "このページの仕組み"]) expect(html).toContain(t);
  });

  it("書類の画面: 付けた書類は「書類だけ先に送る」ができる。送ったファイルは「送りました」で外せない", async () => {
    const p = await packet();
    const id = p.documents[0]!.id;
    const f = { fileId: "AAAAAAAAAAAAAAAA", mime: "image/jpeg" as const, bytes: 10, sha256: "a".repeat(64), label: "写真 1" };
    const a = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: { ...initialDraft(p), documents: { [id]: { status: "attached", files: [f] } } }, startAt: `doc:${p.documents[0]!.id}` }));
    for (const t of ["書類だけ先に送る", "付けました（1）", "外す", "お答えを送った後でも、期限までに同じリンクから送れます"]) expect(a).toContain(t);
    const b = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: { ...initialDraft(p), documents: { [id]: { status: "attached", files: [{ ...f, sentAt: "2026-11-05T09:00:00Z" }] } } }, startAt: `doc:${p.documents[0]!.id}` }));
    for (const t of ["送りました（1）", "送りました"]) expect(b).toContain(t);
    expect(b).not.toContain("書類だけ先に送る");
    expect(b).not.toContain(">外す<");
  });

  it("答えの後の書類の画面（同じ URL を開き直した）: 答えはもう送ってあること・期限まで何回でも・手元にない／あとで送るは出さない・この端末から送った書類の控え", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), answeredAt: "2026-11-06T01:00:00Z", more: { documents: {}, sent: [{ at: "2026-11-06T01:00:00Z", items: [{ id: p.documents[0]!.id, files: 2 }] }] }, now: () => NOW }));
    for (const t of ["書類を送る", "お答えは11月6日に送っていただいています", "このページから何回でも送れます", "撮る", "ファイルを選ぶ", "この端末から送った書類", `${p.documents[0]!.title}（2）`, "書類を付けてください"]) expect(html).toContain(t);
    expect(html).not.toContain("手元にない");
    expect(html).not.toContain("あとで送る");
    expect(html).toContain('data-hf-screen="more"');
  });
});
