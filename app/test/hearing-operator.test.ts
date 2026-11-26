// お客さまのページの運営者の1行と説明のページ（0138 の追記 2026-11-26。電気通信事業法の外部送信の規律に合わせる。利用者の判断）:
// 最初の画面のいちばん下の1行とリンク・文字の大きさ・説明のページを配る物に入れる・CSP を変えない・説明のページは外の部品を読まない
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { PAGE_HEADERS } from "../../hearing/relay/handler.ts";
import { initialDraft, screenId, screens } from "../../hearing/src/web/flow.ts";
import { HEARING_PAGES } from "../scripts/build-hearing-form.ts";
import { APP_DIR } from "../scripts/lib.ts";
import { HearingForm } from "../src/hearingForm/Form.tsx";
import { ABOUT_LINK_TEXT, ABOUT_PATH, OPERATOR_NAME } from "../src/hearingForm/operator.ts";
import { documentFromTemplate, officeFace, previewPacket, templateSelection } from "../src/workspace/hearing/web.ts";
import { blankHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";

const NOW = new Date("2026-11-05T09:00:00Z");
let n = 0;
const wh = withRefreshedEstimates(blankHousehold("2026-11", () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`));

async function packet(name = "【架空】みらいFP事務所") {
  const office = officeFace({ name, color: "#2f6f5e", purpose: "ライフプランの作成のため", privacyContact: "【架空】窓口" });
  const sel0 = templateSelection("simple", wh);
  return previewPacket(wh, { ...sel0, documents: [documentFromTemplate(sel0, "withholding")] }, office, NOW);
}

const LINE = `このページの運営: ${OPERATOR_NAME} ｜ `;
const read = (rel: string) => readFileSync(join(APP_DIR, rel), "utf8");

/** CSS の1つの決まりの中身（最初に見つかったもの） */
function rule(css: string, selector: string): string {
  const i = css.indexOf(`\n${selector} {`);
  if (i < 0) throw new Error(`${selector} がありません`);
  return css.slice(i, css.indexOf("}", i));
}
const px = (block: string) => Number(/font-size:\s*(\d+)px/.exec(block)?.[1]);

/** 本番と同じ CSP（変えていないことの確かめ。変えるときは設計の記録と一緒に） */
const SERVER_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; font-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const META_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'" />`;

describe("運営者の1行（最初の画面のいちばん下）", () => {
  it("お客さまのページ: 1行が最初の画面のいちばん下（「このページの仕組み」の下）に出て、後半は説明のページへのリンク", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "live", initial: initialDraft(p), now: () => NOW }));
    expect(html).toContain('data-hf-screen="intro"');
    expect(html).toContain(LINE);
    expect(html).toContain(`<a href="${ABOUT_PATH}" target="_blank" rel="noopener noreferrer" data-hf-about-link="true">${ABOUT_LINK_TEXT}</a>`);
    // 1行は「このページの仕組み」の後で、本文の最後
    const line = html.indexOf("data-hf-operator");
    expect(line).toBeGreaterThan(html.indexOf("data-hf-about"));
    expect(html.indexOf("</main>")).toBeGreaterThan(line);
    expect(html.slice(line, html.indexOf("</main>"))).not.toMatch(/<(p|ul|details|section)[ >]/);
    // 「このページの仕組み」の中にも、運営者の名前と同じリンク
    const about = html.slice(html.indexOf("data-hf-about"), line);
    expect(about).toContain(`このページの運営は${OPERATOR_NAME}です。`);
    expect(about).toContain(`href="${ABOUT_PATH}"`);
    expect(ABOUT_PATH).toBe("/h/about/");
  });

  it("事務所名が空欄でも出る。答えを送った後に開き直した「書類を送る」の画面にも出る", async () => {
    const p = await packet("");
    const intro = renderToString(h(HearingForm, { packet: p, mode: "live", initial: initialDraft(p), now: () => NOW }));
    expect(intro).toContain(LINE);
    const more = renderToString(h(HearingForm, { packet: p, mode: "live", initial: initialDraft(p), answeredAt: "2026-11-06T01:00:00Z", now: () => NOW }));
    expect(more).toContain('data-hf-screen="more"');
    expect(more).toContain(LINE);
    expect(more.indexOf("data-hf-operator")).toBeGreaterThan(more.indexOf("data-hf-about"));
  });

  it("問いの画面・入力内容の確認画面・送った後の画面には出さない", async () => {
    const p = await packet();
    const d = { ...initialDraft(p), gates: { spouse: 0, child: 0 } };
    const first = screenId(screens(p, d).find((s) => s.kind === "item")!);
    for (const startAt of [first, "review", "sent"]) {
      const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt, now: () => NOW }));
      expect(html).not.toContain("data-hf-operator");
    }
  });

  it("FP のアプリの見本: 同じ1行を出すが、リンクは開かない（アプリの画面から外のページへ移らない）", async () => {
    const p = await packet();
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), now: () => NOW }));
    expect(html).toContain(LINE);
    expect(html).toContain(`<span class="hf-about-link" data-hf-about-link="true">${ABOUT_LINK_TEXT}</span>`);
    expect(html).not.toContain(`href="${ABOUT_PATH}"`);
  });

  it("文字の大きさは本文に近い（本文 18px に対して 16px。「このページの仕組み」の 14px より大きい）", () => {
    const css = read("src/hearingForm/form.css");
    const body = px(rule(css, ".hf"));
    const line = px(rule(css, ".hf-operator"));
    expect(body).toBe(18);
    expect(line).toBeGreaterThanOrEqual(16);
    expect(body - line).toBeLessThanOrEqual(2);
    expect(line).toBeGreaterThan(px(rule(css, ".hf-about")));
    // リンクの文字を小さくしない
    expect(rule(css, ".hf-about a,\n.hf-operator a")).not.toContain("font-size");
    expect(rule(css, ".hf-about-link")).not.toContain("font-size");
  });
});

describe("説明のページ（h/about/index.html）", () => {
  const about = read(HEARING_PAGES.about);

  it("配る物に入る（お客さまのページと同じ /h/ の下。リンクの先と同じ場所）", () => {
    expect(Object.values(HEARING_PAGES)).toEqual(["h/index.html", "h/about/index.html"]);
    expect(`/${HEARING_PAGES.about}`.replace(/index\.html$/, "")).toBe(ABOUT_PATH);
  });

  it("運営者の名前・送られる情報・送り先・目的・送らないもの。決まっていない所（問い合わせ・制定日）は印", () => {
    expect(about).toContain(`<title>${ABOUT_LINK_TEXT}</title>`);
    expect(about).toContain(`<h1>${ABOUT_LINK_TEXT}</h1>`);
    for (const t of [OPERATOR_NAME, "ご回答と、添付していただいた書類", "リンクから作られる番号と合言葉", "通信のときに自動で届く情報", "送り先（情報を取り扱う者）", "目的", "Cloudflare, Inc.", "広告や利用状況の解析のための送信はしていません", "鍵をかけて残します（送りません）", "受け取られないまま期限を過ぎたときも消えます"]) expect(about).toContain(t);
    expect(about.match(/data-ab-row=/g)?.length).toBe(3);
    expect(about).toContain('<dd data-ab-pending="contact">【決まったら入れる】</dd>');
    expect(about).toContain('<dd data-ab-pending="date">【決まったら入れる】</dd>');
    // 入れていない部品（Turnstile）は書かない
    expect(about).not.toContain("Turnstile");
  });

  it("外の部品を読まない: スクリプトなし・外の URL なし・読むのは同じ所の CSS だけ", () => {
    expect(about).not.toMatch(/<script/i);
    expect(about).not.toMatch(/<(img|iframe|object|embed|video|audio|form)\b/i);
    expect(about).not.toMatch(/https?:\/\//);
    expect(about).not.toMatch(/\sstyle=/i);
    const refs = [...about.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
    expect(refs).toEqual(["/src/hearingForm/about.css"]);
  });

  it("説明のページの CSS は、お客さまのページに効かない（説明のページの body の印の下だけ）", () => {
    const css = read("src/hearingForm/about.css");
    expect(css).not.toMatch(/(^|\n)\s*(html|body|:root)\s*[{,]/);
    expect(css).not.toMatch(/url\(|@import/);
  });
});

describe("CSP を変えていない", () => {
  it("サーバーの見出し・お客さまのページと説明のページの meta は今までどおり", () => {
    expect(PAGE_HEADERS["content-security-policy"]).toBe(SERVER_CSP);
    expect(read(HEARING_PAGES.index)).toContain(META_CSP);
    expect(read(HEARING_PAGES.about)).toContain(META_CSP);
  });
});
