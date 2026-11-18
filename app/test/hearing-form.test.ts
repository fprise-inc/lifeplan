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
  it("最初の画面: 見出しは「ライフプラン事前ヒアリング」だけ・問いの数と所要時間・誰が開けるか・期限・名前を書かない・聞かないこと・窓口・このページの仕組み。見本の印", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), now: () => NOW }));
    for (const t of ["<h1>ライフプラン事前ヒアリング</h1>", "画面</b>ほど", "分</b>ほどで答えられます", "【架空】みらいFP事務所の担当の FP だけが開けます", "回答の期限", "お名前は書かないでください", "お名前がなくても", "途中まででも送れます", "面談のときに伺います", "マイナンバー", "【架空】窓口", "このページの仕組み", "担当の FP が受け取ると、このページからは消えます（受け取られないまま回答の期限〔2026年12月5日〕を過ぎたときも消えます）", "見本です", "はじめる"]) expect(html).toContain(t);
    // 事務所名は上の帯に出す。「〇〇からのご質問です」・票の題・何のための問いかは出さない
    expect(html).toContain('<span class="hf-office">【架空】みらいFP事務所</span>');
    for (const t of ["からのご質問です", "ライフプランのための事前のご質問", "ライフプランの作成のためにお聞きします", "提供元", "置き場", "送った物", "うかが"]) expect(html).not.toContain(t);
    expect(html).not.toContain("番号でお客さまを見分けます");
    expect(html).not.toContain("当てはまらない問いは");
    // 事務所の色は CSS の変数で（style の属性に色の値だけ）
    expect(html).toContain("--hf-accent:#2f6f5e");
  });

  it("問いの画面: 働き方と年収を1画面に。年収は具体額の欄が先で、わからなければ範囲で選ぶ。「働いていない」は1つだけ。進み具合は段の名前", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), gates: { spouse: 1, child: 0 } };
    const work = screenId(screens(p, d).find((s) => s.kind === "item" && s.key === "hs.work.type")!);
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: work, now: () => NOW }));
    for (const t of ["いまの働き方", "年収（賞与を含む）", "1年あたり", "万円", "わからなければ、範囲で選ぶ", "わからない", "あとで", "次へ", "戻る", "お仕事と収入"]) expect(html).toContain(t);
    // 金額の欄が範囲の前。範囲のボタンは閉じている（押すと開く）
    expect(html.indexOf('inputmode="decimal"')).toBeLessThan(html.indexOf("わからなければ、範囲で選ぶ"));
    expect(html).not.toContain("500〜600万円");
    expect(html).not.toContain("くわしい額を入れる");
    // 「自営業の方は事業の所得」は自営業を選んだ方にだけ
    expect(html).not.toContain("自営業の方は事業の所得");
    const self = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: { ...d, answers: { [draftKey("hs.work.type", 1)]: { status: "value" as const, raw: { kind: "text" as const, text: "selfEmployed" } } } }, startAt: work, now: () => NOW }));
    expect(self).toContain("年収（賞与を含む。自営業の方は事業の所得）");
    // 範囲で答えてあれば、範囲のボタンを開いて出す（選んだ範囲が光る）
    const ranged = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: { ...d, answers: { [draftKey("hs.income.annualRange", 1)]: { status: "value" as const, raw: { kind: "text" as const, text: "500〜600万円" } } } }, startAt: work, now: () => NOW }));
    for (const t of ["わからなければ、だいたいの範囲を選んでください（1年あたり）", "500〜600万円", 'aria-checked="true"']) expect(ranged).toContain(t);
    expect(html.split("働いていない").length - 1).toBe(1);
    expect(html).not.toContain("当てはまらない");
    // 分母は出さない（段の印と名前）
    expect(html).not.toMatch(/\d+ \/ \d+/);
    // 生年月・性別は人ごとに1画面（年齢の欄は出さない）。年は15年前から、月は「わからない」も選べる
    const birth = screenId(screens(p, d).find((s) => s.kind === "item" && s.key === "hs.family.adult.birthYearMonth")!);
    const html2 = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: birth, now: () => NOW }));
    for (const t of ["生まれた年と月", "1986年（昭和61年）", "2011年（平成23年）", "性別", "男性"]) expect(html2).toContain(t);
    // 月の「わからない」は出さない（2026-11-18）
    for (const t of ["年齢", "わからなければ、下の", "わからない", "面談のときに伺います"]) expect(html2).not.toContain(t);
    expect(html2).not.toContain("2012年（平成24年）");
    // 配偶者の方がいるかは分岐の問いで聞くので、生年月に「当てはまらない」は出さない
    expect(html2).not.toContain("当てはまらない");
  });

  it("分岐の問い: 配偶者の方（いる／いない）とお子さまの人数を1画面に（いない／1人／2人…）", async () => {
    const p = await packet();
    const gate = screenId(screens(p, initialDraft(p)).find((s) => s.kind === "gate")!);
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), startAt: gate, now: () => NOW }));
    for (const t of ["配偶者の方", ">いる<", "お子さまは何人", ">いない<", "1人", "2人"]) expect(html).toContain(t);
    expect(html).not.toContain("いらっしゃる<");
    expect(html).not.toContain("いらっしゃらない");
    // 「このページの仕組み」は最初の画面だけ
    expect(html).not.toContain("このページの仕組み");
  });

  it("お子さまは「第一子」「第二子」…の見出し（第三子以降も）", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), gates: { spouse: 0, child: 3 } };
    const kids = screenId(screens(p, d).find((s) => s.kind === "item" && s.key === "hs.family.child.birthYearMonth")!);
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: kids, now: () => NOW }));
    for (const t of ["第一子", "第二子", "第三子", "2029年"]) expect(html).toContain(t);
    for (const t of ["第四子", "お子さま1", "いちばん上"]) expect(html).not.toContain(t);
    // お子さまがいなければ、お子さまの画面は出ない
    expect(screens(p, { ...d, gates: { spouse: 0, child: 0 } }).some((s) => s.kind === "item" && s.key === "hs.family.child.birthYearMonth")).toBe(false);
  });

  it("同意の画面: AI の文は、担当の FP が整理すること（お名前は渡さない）", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), startAt: "consent", now: () => NOW }));
    expect(html).toContain("担当の FP が、AI を使って回答を整理することがあります（お名前は渡しません）");
    expect(html).not.toContain("外部のAIサービス");
  });

  it("書類の画面: 撮影する前の注意（マイナンバーを隠す）・撮影する（タッチの端末だけ）・ファイルを選ぶ・手元にない・あとで送る・説明", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), startAt: `doc:${p.documents[0]!.id}`, camera: true }));
    for (const t of ["送っていただきたい書類", "撮影する前に", "マイナンバー（個人番号）", "撮影してください", ">撮影する<", 'capture="environment"', "ファイルを選ぶ", "手元にない", "あとで送る", DOCUMENT_TEMPLATES[0]!.purpose]) expect(html).toContain(t);
    expect(html).not.toContain("撮る");
    expect(html).toContain('accept="image/jpeg,image/png,image/heic,image/heif,application/pdf"');
    expect(html).not.toContain("svg+xml");
    // PC（カメラの無い端末。テストの描画も同じ）では「撮影する」を出さず、ファイルを選ぶだけ
    const pc = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), startAt: `doc:${p.documents[0]!.id}` }));
    expect(pc).not.toContain(">撮影する<");
    expect(pc).not.toContain("capture=");
    expect(pc).toContain("ファイルを選ぶ");
  });

  it("入力内容の確認の画面: 答え・まだの数・途中まででも送れる・直す・送る・この端末の入力を消す（「まだの問いに答える」は出さない）", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), started: true, gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.housing.type")]: { status: "value" as const, raw: { kind: "text" as const, text: "rent" } }, [draftKey("hs.housing.rent")]: { status: "value" as const, raw: { kind: "number" as const, text: "９８，０００" } } } };
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: "review", now: () => NOW }));
    for (const t of ["入力内容の確認", "賃貸", "月 98,000円", "直す", "この内容で送る", "まだの問いが", "ご家族の生年月と性別のほかは、途中まででも送れます",  "答えていない所は、面談のときに伺います", "この端末の入力を消す"]) expect(html).toContain(t);
    for (const t of ["お答えの確かめ", "まだの問いに答える", "このページの仕組み", "うかが"]) expect(html).not.toContain(t);
    // 進み具合の段の名前も「入力内容の確認」
    expect(html).toContain("<span>入力内容の確認</span>");
  });

  it("金額を具体額で答えても範囲で答えても、入力内容の確認に出る。住宅ローンの残高は範囲が先", async () => {
    const p = await packet();
    const own = { ...initialDraft(p), started: true, gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.housing.type")]: { status: "value" as const, raw: { kind: "text" as const, text: "own" } }, [draftKey("hs.loan.monthlyTotal")]: { status: "value" as const, raw: { kind: "number" as const, text: "120000" } }, [draftKey("hs.loan.balanceTotalRange")]: { status: "value" as const, raw: { kind: "text" as const, text: p.items.find((i) => i.key === "hs.loan.balanceTotalRange")!.ranges![1]!.label } } } };
    const rv = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: own, startAt: "review", now: () => NOW }));
    expect(rv).toContain("月 120,000円");
    expect(rv).toContain(p.items.find((i) => i.key === "hs.loan.balanceTotalRange")!.ranges![1]!.label);
    // 住まいの画面: 返済額は具体額の欄が先、残高は範囲のボタンが先（くわしい額は開いて入れる）
    const home = screenId(screens(p, own).find((s) => s.kind === "item" && s.key === "hs.housing.type")!);
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: { ...own, answers: { [draftKey("hs.housing.type")]: own.answers[draftKey("hs.housing.type")]! } }, startAt: home, now: () => NOW }));
    expect(html).toContain(`data-hf-range="hs.loan.monthlyTotal"`);
    expect(html).toContain(`data-hf-exact="hs.loan.balanceTotal"`);
    // 前に答えた形のまま開くと、具体額の返済額は欄に額が入り、範囲の残高は範囲のボタンが光る
    const back = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: own, startAt: home, now: () => NOW }));
    expect(back).toContain('value="120000"');
    expect(back).toContain('aria-checked="true"');
  });

  it("送った後の画面: 「事前ヒアリングの内容を送りました」と日時・あとで送る書類・送った内容を見る・印刷する", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), gates: { spouse: 0, child: 0 }, documents: { [p.documents[0]!.id]: { status: "later" as const, files: [] } } };
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: "sent", now: () => NOW }));
    for (const t of ["事前ヒアリングの内容を送りました", "に送りました", "「あとで送る」にした書類", "届いたリンクを開き直して送ってください", "書類を続けて送る", "送った内容を見る", "印刷する", "閉じる前に印刷してください"]) expect(html).toContain(t);
    for (const t of ["に届きました", "このページの仕組み"]) expect(html).not.toContain(t);
  });

  it("書類の画面: 添付した書類は「書類だけ先に送る」ができる。送ったファイルは「送りました」で外せない", async () => {
    const p = await packet();
    const id = p.documents[0]!.id;
    const f = { fileId: "AAAAAAAAAAAAAAAA", mime: "image/jpeg" as const, bytes: 10, sha256: "a".repeat(64), label: "写真 1" };
    const a = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: { ...initialDraft(p), documents: { [id]: { status: "attached", files: [f] } } }, startAt: `doc:${p.documents[0]!.id}` }));
    for (const t of ["書類だけ先に送る", "添付しました（1）", "添付した書類は、最後に回答と一緒に送ります", "外す", "回答を送った後でも、期限までに同じリンクから送れます"]) expect(a).toContain(t);
    expect(a).not.toContain("付け");
    const b = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: { ...initialDraft(p), documents: { [id]: { status: "attached", files: [{ ...f, sentAt: "2026-11-05T09:00:00Z" }] } } }, startAt: `doc:${p.documents[0]!.id}` }));
    for (const t of ["送りました（1）", "送りました"]) expect(b).toContain(t);
    expect(b).not.toContain("書類だけ先に送る");
    expect(b).not.toContain(">外す<");
  });

  it("お客さまの画面の「お答え」は「回答」にそろえる（最初の画面・問い・書類・入力内容の確認・送った後）", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), started: true, gates: { spouse: 0, child: 4 } };
    const ids = ["intro", "consent", screenId(screens(p, d).find((s) => s.kind === "gate")!), `doc:${p.documents[0]!.id}`, "review", "sent"];
    for (const startAt of ids) {
      const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt, now: () => NOW }));
      expect(html, startAt).not.toContain("お答え");
    }
    const intro = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, now: () => NOW }));
    for (const t of ["回答は、この端末の中で暗号化してから送ります", "どなたの回答か分かります"]) expect(intro).toContain(t);
    // 分岐の問いの「4人まで」の言い方
    expect(renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: ids[2], now: () => NOW }))).toContain("4人までご回答ください");
  });

  it("書類を頼んでいる依頼: PC ではスマートフォンをすすめる一言（最初の画面・書類の画面・書類を送るの一覧）。スマホ・書類の無い依頼では出さない", async () => {
    const p = await packet();
    const intro = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), now: () => NOW }));
    expect(intro).toContain("書類の撮影があるので、スマートフォンで開くのがおすすめです");
    const doc = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), startAt: `doc:${p.documents[0]!.id}`, now: () => NOW }));
    for (const t of ["スマートフォンで同じリンクを開くと、その場で撮影して送れます。", "回答は、このままこの端末で続けてかまいません。"]) expect(doc).toContain(t);
    const more = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), answeredAt: "2026-11-06T01:00:00Z", now: () => NOW }));
    expect(more).toContain("スマートフォンで同じリンクを開くと、その場で撮影して送れます。");
    expect(more).not.toContain("この端末で続けて");
    // スマホ（撮影するを出す端末）では出さない
    for (const startAt of ["intro", `doc:${p.documents[0]!.id}`]) expect(renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), startAt, now: () => NOW, camera: true }))).not.toContain("スマートフォン");
    // 書類の無い依頼では出さない
    const none = { ...p, documents: [] };
    expect(renderToString(h(HearingForm, { packet: none, mode: "preview", initial: initialDraft(none), now: () => NOW }))).not.toContain("スマートフォン");
  });

  it("答えの後の書類の画面（同じ URL を開き直した）: 答えはもう送ってあること・期限まで何回でも・手元にない／あとで送るは出さない・この端末から送った書類の控え", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), answeredAt: "2026-11-06T01:00:00Z", more: { documents: {}, sent: [{ at: "2026-11-06T01:00:00Z", items: [{ id: p.documents[0]!.id, files: 2 }] }] }, now: () => NOW, camera: true }));
    for (const t of ["書類を送る", "11月6日にご回答いただいています", "このページから何回でも送れます", "撮影する", "ファイルを選ぶ", "この端末から送った書類", `${p.documents[0]!.title}（2）`, "書類を添付してください"]) expect(html).toContain(t);
    expect(html).not.toContain("手元にない");
    expect(html).not.toContain("あとで送る");
    expect(html).toContain('data-hf-screen="more"');
  });
});

describe("お客さまの画面: ご家族の生年月と性別は入れていただく（0138 の追記 2026-11-18）", () => {
  const ym = (y: number, m: number) => ({ status: "value" as const, raw: { kind: "text" as const, text: String(y) }, raw2: { kind: "number" as const, text: String(m) } });
  const pick = (t: string) => ({ status: "value" as const, raw: { kind: "text" as const, text: t } });
  const detail = () => previewPacket(wh, templateSelection("detail", wh), office, NOW);

  it("最初の画面: ご家族の生年月と性別は入れていただくことを、注意に一言", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), now: () => NOW }));
    expect(html).toContain("<li>ご家族の生年月と性別は、ライフプランの土台になるので必ずご入力ください。</li>");
    expect(html).not.toContain("ただ、ご家族の生年月と性別は");
    // いちばん上の箇条（お名前の注意より前）
    expect(html.indexOf("ライフプランの土台になるので")).toBeLessThan(html.indexOf("お名前は書かないでください"));
  });

  it("生年月と性別の画面には「あとで」を出さない（ほかの画面には出す）", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), gates: { spouse: 1, child: 1 } };
    const list = screens(p, d);
    for (const key of ["hs.family.adult.birthYearMonth", "hs.family.child.birthYearMonth"]) {
      const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: screenId(list.find((s) => s.kind === "item" && s.key === key)!), now: () => NOW }));
      expect(html, key).not.toContain('class="hf-later"');
      expect(html, key).toContain("次へ");
    }
    const work = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: screenId(list.find((s) => s.kind === "item" && s.key === "hs.work.type")!), now: () => NOW }));
    expect(work).toContain('class="hf-later"');
  });

  it("詳細の票のお子さまの性別: 「わからない」は生まれる前のお子さまだけに出す", async () => {
    const p = await detail();
    const base = { ...initialDraft(p), gates: { spouse: 0, child: 1 } };
    const at = screenId(screens(p, base).find((s) => s.kind === "item" && s.key === "hs.family.child.birthYearMonth")!);
    const born = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: { ...base, answers: { [draftKey("hs.family.child.birthYearMonth", 1)]: ym(2018, 6) } }, startAt: at, now: () => NOW }));
    expect(born).toContain("男の子");
    expect(born).not.toContain(">わからない<");
    const coming = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: { ...base, answers: { [draftKey("hs.family.child.birthYearMonth", 1)]: ym(2027, 3) } }, startAt: at, now: () => NOW }));
    expect(coming).toContain(">わからない<");
  });

  it("入力内容の確認: 欠けていれば、やわらかい一言と、最初に欠けている画面へ戻るボタン（送る前に入れていただく）。そろっていれば出さない", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), started: true, gates: { spouse: 1, child: 0 }, answers: { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1986, 4), [draftKey("hs.family.adult.sex", 1)]: pick("female"), [draftKey("hs.family.adult.birthYearMonth", 2)]: { status: "later" as const } } };
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: "review", now: () => NOW }));
    for (const t of ['data-hf-need="top"', "配偶者の方の生年月と性別は、ライフプランの計算に使うので、入れていただけますか。", "配偶者の方の生年月と性別を入れる", "この内容で送る", "途中まででも送れます"]) expect(html).toContain(t);
    for (const t of ["必須", "入力してください"]) expect(html).not.toContain(t);
    // 配偶者の方を「いない」にすれば、隠れた欄は見ない（残った「あとで」でも止めない）
    const none = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: { ...d, gates: { spouse: 0, child: 0 } }, startAt: "review", now: () => NOW }));
    expect(none).not.toContain("data-hf-need");
  });
});
