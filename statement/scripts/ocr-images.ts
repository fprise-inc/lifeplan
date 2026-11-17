// 文字認識の試し（0034 の段階3）に使う、架空の明細の画像を作る。すべて架空（実在の人・番号・店・カード会社・銀行の名前やロゴは使わない）。
// 店の名前は 0034 の追記（2026-11-01）の決まりの架空の名前。番号はすべて 0 の並び。
//   node scripts/ocr-images.ts   … test/fixtures/ocr/ に画像と正解（truth.json）を書く
// 作り方: 明細の形（文字・線・塗り）をここで決め、Chrome（ヘッドレス）の canvas で描いて、写真風・スキャン風の崩し
// （傾き・ぼけ・明るさむら・ざらつき・JPEG）を足す。前処理（拡大・二値化・傾き直し）を当てた画像も同じページで作る。
// Chrome の場所は環境変数 CHROME で替えられる。描く字は OS の字形（macOS のヒラギノ）なので、作り直すと少し変わる（画像はコミットしたものを使う）
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DIR = join(import.meta.dirname, "..", "test", "fixtures", "ocr");

type Align = "left" | "right";
type El =
  | { t: "text"; x: number; y: number; text: string; size: number; weight?: number; font?: string; color?: string; align?: Align }
  | { t: "rect"; x: number; y: number; w: number; h: number; fill: string }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; color?: string; width?: number };

/** 正解の1件（表に出した文字のまま。日付は YYYY-MM-DD も持つ） */
interface TruthRow {
  date: string;
  dateText: string;
  merchant: string;
  amountText: string;
  amount: number;
}

interface Fx {
  /** 傾き（度。時計回り） */
  rotate?: number;
  /** 周りの机の幅（画素）と色 */
  margin?: number;
  desk?: string;
  blur?: number;
  /** 明るさむら（右下を暗く、左上に光） */
  light?: number;
  noise?: number;
  gray?: boolean;
  /** コントラストを下げる（0〜1。スキャンの薄さ） */
  fade?: number;
}

interface Doc {
  id: string;
  label: string;
  kind: "card" | "bank" | "invoice";
  width: number;
  height: number;
  /** 描く倍率（スクショの画面の倍率・スキャンの解像度） */
  scale: number;
  paper: string;
  els: El[];
  rows: TruthRow[];
  out: { file: string; label: string; fx: Fx; type: "image/png" | "image/jpeg"; quality?: number };
}

const SANS = "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Meiryo', sans-serif";
const SERIF = "'Hiragino Mincho ProN', 'Yu Mincho', serif";
const yen = (n: number) => (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US");
const pad = (n: number) => String(n).padStart(2, "0");

// ---- 店と金額（架空） ----
interface Use {
  d: number;
  m: string;
  plan: string;
  a: number;
}
const CARD_USES: Use[] = [
  { d: 1, m: "あおばマート みどり一丁目店", plan: "1回払い", a: 3280 },
  { d: 2, m: "ひかりスーパー", plan: "1回払い", a: 5412 },
  { d: 4, m: "みどりドラッグ", plan: "1回払い", a: 1078 },
  { d: 6, m: "みどりガソリン", plan: "1回払い", a: 6200 },
  { d: 8, m: "そよかぜクリーニング 駅前店", plan: "1回払い", a: 880 },
  { d: 9, m: "みどり食堂", plan: "1回払い", a: 1350 },
  { d: 11, m: "ほしぞらホームセンター", plan: "分割3回", a: 38400 },
  { d: 12, m: "PAYPAY*そらまめカフェ", plan: "1回払い", a: 620 },
  { d: 14, m: "ひかりスーパー", plan: "1回払い", a: 4987 },
  { d: 15, m: "XYZ携帯 ご利用料金", plan: "1回払い", a: 7315 },
  { d: 17, m: "みどり電力", plan: "1回払い", a: 8432 },
  { d: 19, m: "あおばマート みどり一丁目店", plan: "1回払い", a: 2146 },
  { d: 22, m: "こもれび書店", plan: "1回払い", a: 1980 },
  { d: 24, m: "みどりドラッグ", plan: "1回払い", a: -1078 },
  { d: 26, m: "ほしぞらシネマ", plan: "1回払い", a: 3600 },
  { d: 29, m: "そよかぜクリーニング 駅前店", plan: "1回払い", a: 1210 },
];

function cardRows(uses: readonly Use[], dateText: (d: number) => string): TruthRow[] {
  return uses.map((u) => ({ date: `2026-10-${pad(u.d)}`, dateText: dateText(u.d), merchant: u.m, amountText: yen(u.a), amount: u.a }));
}

/** 架空であることの印（どの画像にも入れる） */
const mark = (x: number, y: number, size = 12): El => ({ t: "text", x, y, text: "見本（架空のデータ）", size, color: "#b04040", weight: 600, font: SANS });

// 1. カードの明細の画面のスクショ（PC。画面の倍率 1）
function cardWeb(): Doc {
  const W = 980;
  const els: El[] = [
    { t: "rect", x: 0, y: 0, w: W, h: 56, fill: "#1f4e79" },
    { t: "text", x: 24, y: 36, text: "アオバカード 会員ページ", size: 18, weight: 700, color: "#fff", font: SANS },
    mark(820, 34),
    { t: "text", x: 30, y: 100, text: "ご利用明細", size: 22, weight: 700, color: "#222", font: SANS },
    { t: "text", x: 30, y: 132, text: "2026年11月10日お支払い分", size: 15, color: "#333", font: SANS },
    { t: "text", x: 30, y: 158, text: "カード番号 0000-XXXX-XXXX-0000", size: 13, color: "#555", font: SANS },
  ];
  const cols = { date: 30, shop: 140, plan: 640, amount: 950 };
  let y = 190;
  els.push({ t: "rect", x: 20, y, w: W - 40, h: 34, fill: "#e8eef5" });
  for (const [k, x] of Object.entries(cols)) {
    const text = { date: "ご利用日", shop: "ご利用店名", plan: "支払区分", amount: "ご利用金額" }[k] as string;
    els.push({ t: "text", x, y: y + 22, text, size: 14, weight: 600, color: "#333", font: SANS, align: k === "amount" ? "right" : "left" });
  }
  y += 34;
  CARD_USES.forEach((u, i) => {
    if (i % 2 === 1) els.push({ t: "rect", x: 20, y, w: W - 40, h: 32, fill: "#f7f9fb" });
    els.push({ t: "text", x: cols.date, y: y + 21, text: `10/${pad(u.d)}`, size: 14, color: "#222", font: SANS });
    els.push({ t: "text", x: cols.shop, y: y + 21, text: u.m, size: 14, color: "#222", font: SANS });
    els.push({ t: "text", x: cols.plan, y: y + 21, text: u.plan, size: 14, color: "#222", font: SANS });
    els.push({ t: "text", x: cols.amount, y: y + 21, text: yen(u.a), size: 14, color: u.a < 0 ? "#c00" : "#222", font: SANS, align: "right" });
    els.push({ t: "line", x1: 20, y1: y + 32, x2: W - 20, y2: y + 32, color: "#dde3ea" });
    y += 32;
  });
  const total = CARD_USES.reduce((s, u) => s + u.a, 0);
  els.push({ t: "text", x: cols.plan, y: y + 30, text: "ご利用合計", size: 15, weight: 700, color: "#222", font: SANS });
  els.push({ t: "text", x: cols.amount, y: y + 30, text: yen(total), size: 15, weight: 700, color: "#222", font: SANS, align: "right" });
  return {
    id: "card-web",
    label: "カードの明細の画面のスクショ（PC・等倍）",
    kind: "card",
    width: W,
    height: y + 60,
    scale: 1,
    paper: "#ffffff",
    els,
    rows: cardRows(CARD_USES, (d) => `10/${pad(d)}`),
    out: { file: "card-web.png", label: "カード・PC のスクショ", fx: {}, type: "image/png" },
  };
}

// 2. カードの明細のスマホのスクショ（画面の倍率 3。1件が2行: 店と金額、その下に日付と支払区分）
function cardPhone(): Doc {
  const W = 390;
  const uses = CARD_USES.slice(0, 10);
  const els: El[] = [
    { t: "text", x: 24, y: 30, text: "9:41", size: 15, weight: 600, color: "#111", font: SANS },
    { t: "text", x: 16, y: 80, text: "ご利用明細", size: 20, weight: 700, color: "#111", font: SANS },
    mark(250, 80, 11),
    { t: "text", x: 16, y: 108, text: "2026年11月10日お支払い分", size: 13, color: "#555", font: SANS },
    { t: "rect", x: 16, y: 122, w: W - 32, h: 64, fill: "#f2f5f9" },
    { t: "text", x: 28, y: 148, text: "お支払金額", size: 12, color: "#555", font: SANS },
    { t: "text", x: W - 28, y: 174, text: `${yen(uses.reduce((s, u) => s + u.a, 0))}円`, size: 22, weight: 700, color: "#111", font: SANS, align: "right" },
  ];
  let y = 204;
  for (const u of uses) {
    els.push({ t: "text", x: 16, y: y + 24, text: u.m, size: 15, weight: 600, color: "#111", font: SANS });
    els.push({ t: "text", x: W - 16, y: y + 24, text: `${yen(u.a)}円`, size: 15, weight: 600, color: u.a < 0 ? "#c00" : "#111", font: SANS, align: "right" });
    els.push({ t: "text", x: 16, y: y + 46, text: `2026/10/${pad(u.d)}`, size: 12, color: "#777", font: SANS });
    els.push({ t: "text", x: W - 16, y: y + 46, text: u.plan, size: 12, color: "#777", font: SANS, align: "right" });
    els.push({ t: "line", x1: 16, y1: y + 60, x2: W - 16, y2: y + 60, color: "#e3e6ea" });
    y += 62;
  }
  return {
    id: "card-phone",
    label: "カードの明細のスマホのスクショ（3倍・1件が2行）",
    kind: "card",
    width: W,
    height: y + 20,
    scale: 3,
    paper: "#ffffff",
    els,
    rows: cardRows(uses, (d) => `2026/10/${pad(d)}`),
    out: { file: "card-phone.png", label: "カード・スマホのスクショ", fx: {}, type: "image/png" },
  };
}

// 3. 銀行の入出金明細のスキャン（明朝・グレー・薄い・少し傾き・ざらつき）
function bankScan(): Doc {
  const W = 760;
  const els: El[] = [
    mark(560, 30, 11),
    { t: "text", x: 40, y: 60, text: "ほしぞら銀行 入出金明細", size: 20, weight: 600, color: "#111", font: SERIF },
    { t: "text", x: 40, y: 90, text: "普通預金 口座番号 0000000", size: 13, color: "#111", font: SERIF },
    { t: "text", x: 40, y: 112, text: "期間 2026年10月1日〜2026年10月31日", size: 13, color: "#111", font: SERIF },
  ];
  const cols = { date: 40, memo: 150, out: 470, in: 580, bal: 720 };
  let y = 130;
  els.push({ t: "line", x1: 30, y1: y, x2: W - 30, y2: y, color: "#222", width: 1.2 });
  const heads: [keyof typeof cols, string][] = [
    ["date", "日付"],
    ["memo", "摘要"],
    ["out", "お引出し"],
    ["in", "お預入れ"],
    ["bal", "残高"],
  ];
  for (const [k, text] of heads) els.push({ t: "text", x: cols[k], y: y + 20, text, size: 13, color: "#111", font: SERIF, align: k === "date" || k === "memo" ? "left" : "right" });
  y += 28;
  els.push({ t: "line", x1: 30, y1: y, x2: W - 30, y2: y, color: "#222" });
  const moves: { d: number; memo: string; out?: number; in?: number }[] = [
    { d: 5, memo: "カード アオバカード", out: 59000 },
    { d: 10, memo: "デンキ ミドリデンリヨク", out: 8432 },
    { d: 15, memo: "振込 ミドリ タロウ", out: 30000 },
    { d: 20, memo: "ATM ホシゾラエキマエ", out: 20000 },
    { d: 25, memo: "給与 ホシゾラシヨウジ", in: 312000 },
    { d: 27, memo: "スイドウ ミドリシ", out: 4180 },
    { d: 28, memo: "XYZケイタイ", out: 7315 },
    { d: 31, memo: "利息", in: 3 },
  ];
  let bal = 182450;
  els.push({ t: "text", x: cols.date, y: y + 20, text: "2026.10.01", size: 13, color: "#111", font: SERIF });
  els.push({ t: "text", x: cols.memo, y: y + 20, text: "前月繰越", size: 13, color: "#111", font: SERIF });
  els.push({ t: "text", x: cols.bal, y: y + 20, text: yen(bal), size: 13, color: "#111", font: SERIF, align: "right" });
  y += 28;
  const rows: TruthRow[] = [];
  for (const mv of moves) {
    bal += (mv.in ?? 0) - (mv.out ?? 0);
    const dateText = `2026.10.${pad(mv.d)}`;
    els.push({ t: "text", x: cols.date, y: y + 20, text: dateText, size: 13, color: "#111", font: SERIF });
    els.push({ t: "text", x: cols.memo, y: y + 20, text: mv.memo, size: 13, color: "#111", font: SERIF });
    if (mv.out !== undefined) els.push({ t: "text", x: cols.out, y: y + 20, text: yen(mv.out), size: 13, color: "#111", font: SERIF, align: "right" });
    if (mv.in !== undefined) els.push({ t: "text", x: cols.in, y: y + 20, text: yen(mv.in), size: 13, color: "#111", font: SERIF, align: "right" });
    els.push({ t: "text", x: cols.bal, y: y + 20, text: yen(bal), size: 13, color: "#111", font: SERIF, align: "right" });
    els.push({ t: "line", x1: 30, y1: y + 28, x2: W - 30, y2: y + 28, color: "#999", width: 0.6 });
    const amount = mv.out ?? -(mv.in as number);
    rows.push({ date: `2026-10-${pad(mv.d)}`, dateText, merchant: mv.memo, amountText: yen(Math.abs(amount)), amount });
    y += 28;
  }
  return {
    id: "bank-scan",
    label: "銀行の入出金明細のスキャン（明朝・グレー・少し傾き）",
    kind: "bank",
    width: W,
    height: y + 50,
    scale: 1.6,
    paper: "#ffffff",
    els,
    rows,
    out: { file: "bank-scan.jpg", label: "銀行・スキャン", fx: { rotate: 0.6, margin: 12, desk: "#ffffff", blur: 0.5, noise: 10, gray: true, fade: 0.25 }, type: "image/jpeg", quality: 0.8 },
  };
}

/** 紙のカードの明細（写真・小さい字で使う） */
function cardPaper(size: number, uses: readonly Use[]): { els: El[]; height: number; width: number } {
  const W = Math.round(size * 52);
  const lh = Math.round(size * 1.9);
  const els: El[] = [
    mark(W - size * 11, size * 2.2, size * 0.9),
    { t: "text", x: size * 2, y: size * 4, text: "アオバカード ご利用代金明細書", size: size * 1.5, weight: 700, color: "#111", font: SANS },
    { t: "text", x: size * 2, y: size * 6.2, text: "2026年11月10日お支払い分", size, color: "#111", font: SANS },
  ];
  const cols = { date: size * 2, shop: size * 8, user: size * 30, plan: size * 35, amount: W - size * 2 };
  let y = size * 8;
  els.push({ t: "line", x1: size, y1: y, x2: W - size, y2: y, color: "#333" });
  const heads: [keyof typeof cols, string][] = [
    ["date", "ご利用日"],
    ["shop", "ご利用店名"],
    ["user", "ご利用者"],
    ["plan", "支払区分"],
    ["amount", "ご利用金額"],
  ];
  for (const [k, text] of heads) els.push({ t: "text", x: cols[k], y: y + lh * 0.72, text, size, weight: 600, color: "#111", font: SANS, align: k === "amount" ? "right" : "left" });
  y += lh;
  els.push({ t: "line", x1: size, y1: y, x2: W - size, y2: y, color: "#333" });
  for (const u of uses) {
    const base = y + lh * 0.72;
    els.push({ t: "text", x: cols.date, y: base, text: `10/${pad(u.d)}`, size, color: "#111", font: SANS });
    els.push({ t: "text", x: cols.shop, y: base, text: u.m, size, color: "#111", font: SANS });
    els.push({ t: "text", x: cols.user, y: base, text: "本人", size, color: "#111", font: SANS });
    els.push({ t: "text", x: cols.plan, y: base, text: u.plan, size, color: "#111", font: SANS });
    els.push({ t: "text", x: cols.amount, y: base, text: yen(u.a), size, color: "#111", font: SANS, align: "right" });
    y += lh;
  }
  els.push({ t: "line", x1: size, y1: y, x2: W - size, y2: y, color: "#333" });
  return { els, height: Math.round(y + size * 3), width: W };
}

// 4. 紙のカードの明細を少し斜めから撮った写真（傾き・ぼけ・明るさむら・ざらつき・JPEG）
function cardPhoto(): Doc {
  const p = cardPaper(14, CARD_USES);
  return {
    id: "card-photo",
    label: "紙のカードの明細の写真（傾き3度・ぼけ・明るさむら・JPEG）",
    kind: "card",
    width: p.width,
    height: p.height,
    scale: 1.6,
    paper: "#fbfaf6",
    els: p.els,
    rows: cardRows(CARD_USES, (d) => `10/${pad(d)}`),
    out: { file: "card-photo.jpg", label: "カード・斜めの写真", fx: { rotate: 3, margin: 70, desk: "#6b5a48", blur: 1.1, light: 0.45, noise: 9 }, type: "image/jpeg", quality: 0.72 },
  };
}

// 5. 小さい字のカードの明細（縮めたスクショ。字の高さ 9 画素）
function cardSmall(): Doc {
  const uses = [...CARD_USES, ...CARD_USES.slice(0, 8).map((u) => ({ ...u, d: Math.min(30, u.d + 1) }))].sort((a, b) => a.d - b.d);
  const p = cardPaper(9, uses);
  return {
    id: "card-small",
    label: "小さい字のカードの明細（字の高さ 9 画素・24件）",
    kind: "card",
    width: p.width,
    height: p.height,
    scale: 1,
    paper: "#ffffff",
    els: p.els,
    rows: cardRows(uses, (d) => `10/${pad(d)}`),
    out: { file: "card-small.png", label: "カード・小さい字", fx: {}, type: "image/png" },
  };
}

// 6. 電気の請求書（1枚に1件）
function invoicePower(): Doc {
  const W = 620;
  const els: El[] = [
    mark(450, 28, 11),
    { t: "text", x: 30, y: 60, text: "みどり電力", size: 22, weight: 700, color: "#1d6b3a", font: SANS },
    { t: "text", x: 30, y: 92, text: "電気ご使用量のお知らせ（ご請求書）", size: 16, weight: 600, color: "#111", font: SANS },
    { t: "text", x: 30, y: 124, text: "お客さま番号 0000000000", size: 13, color: "#333", font: SANS },
    { t: "text", x: 30, y: 148, text: "ご使用期間 2026年10月1日〜2026年10月31日", size: 13, color: "#333", font: SANS },
    { t: "text", x: 30, y: 172, text: "ご使用量 312kWh", size: 13, color: "#333", font: SANS },
    { t: "rect", x: 24, y: 190, w: W - 48, h: 70, fill: "#eef6f0" },
    { t: "text", x: 40, y: 233, text: "ご請求金額", size: 16, weight: 600, color: "#111", font: SANS },
    { t: "text", x: W - 40, y: 236, text: "8,432円", size: 28, weight: 700, color: "#111", font: SANS, align: "right" },
    { t: "text", x: 30, y: 292, text: "お支払期日 2026年11月26日", size: 14, color: "#111", font: SANS },
    { t: "text", x: 30, y: 330, text: "内訳", size: 14, weight: 600, color: "#111", font: SANS },
  ];
  const items: [string, string][] = [
    ["基本料金", "935円"],
    ["電力量料金", "7,013円"],
    ["再エネ賦課金", "1,216円"],
    ["燃料費調整額", "-732円"],
  ];
  let y = 340;
  for (const [k, v] of items) {
    els.push({ t: "text", x: 50, y: y + 22, text: k, size: 13, color: "#222", font: SANS });
    els.push({ t: "text", x: W - 40, y: y + 22, text: v, size: 13, color: "#222", font: SANS, align: "right" });
    els.push({ t: "line", x1: 40, y1: y + 30, x2: W - 30, y2: y + 30, color: "#ddd" });
    y += 30;
  }
  return {
    id: "invoice-power",
    label: "電気の請求書（1枚に1件）",
    kind: "invoice",
    width: W,
    height: y + 40,
    scale: 1.5,
    paper: "#ffffff",
    els,
    rows: [{ date: "2026-11-26", dateText: "2026年11月26日", merchant: "みどり電力", amountText: "8,432", amount: 8432 }],
    out: { file: "invoice-power.png", label: "電気の請求書", fx: {}, type: "image/png" },
  };
}

// 7. 携帯の請求書の写真（1枚に3件。少し傾き・ぼけ・明るさむら）
function invoiceMobile(): Doc {
  const W = 600;
  const els: El[] = [
    mark(440, 28, 11),
    { t: "text", x: 30, y: 62, text: "XYZ携帯 ご請求書", size: 22, weight: 700, color: "#222", font: SANS },
    { t: "text", x: 30, y: 94, text: "ご請求月 2026年11月", size: 14, color: "#333", font: SANS },
    { t: "text", x: 30, y: 118, text: "お支払日 2026年11月27日", size: 14, color: "#333", font: SANS },
    { t: "text", x: 30, y: 142, text: "ご契約番号 0000000000", size: 13, color: "#555", font: SANS },
  ];
  const items: [string, number][] = [
    ["月額基本料", 2970],
    ["通話料", 385],
    ["端末代金（分割 12/24回）", 3960],
  ];
  let y = 170;
  els.push({ t: "line", x1: 24, y1: y, x2: W - 24, y2: y, color: "#333" });
  els.push({ t: "text", x: 40, y: y + 24, text: "ご利用内容", size: 14, weight: 600, color: "#111", font: SANS });
  els.push({ t: "text", x: W - 40, y: y + 24, text: "金額", size: 14, weight: 600, color: "#111", font: SANS, align: "right" });
  y += 34;
  for (const [k, v] of items) {
    els.push({ t: "text", x: 40, y: y + 24, text: k, size: 14, color: "#111", font: SANS });
    els.push({ t: "text", x: W - 40, y: y + 24, text: `${yen(v)}円`, size: 14, color: "#111", font: SANS, align: "right" });
    els.push({ t: "line", x1: 30, y1: y + 34, x2: W - 30, y2: y + 34, color: "#ccc" });
    y += 34;
  }
  const total = items.reduce((s, [, v]) => s + v, 0);
  els.push({ t: "text", x: 40, y: y + 30, text: "ご請求金額合計", size: 16, weight: 700, color: "#111", font: SANS });
  els.push({ t: "text", x: W - 40, y: y + 30, text: `${yen(total)}円`, size: 18, weight: 700, color: "#111", font: SANS, align: "right" });
  return {
    id: "invoice-mobile",
    label: "携帯の請求書の写真（1枚に3件・傾き1.5度）",
    kind: "invoice",
    width: W,
    height: y + 60,
    scale: 1.6,
    paper: "#fdfdfb",
    els,
    rows: items.map(([k, v]) => ({ date: "2026-11-27", dateText: "2026年11月27日", merchant: k, amountText: yen(v), amount: v })),
    out: { file: "invoice-mobile.jpg", label: "携帯の請求書・写真", fx: { rotate: -1.5, margin: 50, desk: "#8a8f96", blur: 0.7, light: 0.35, noise: 7 }, type: "image/jpeg", quality: 0.75 },
  };
}

/** 前処理（拡大・二値化・傾き直し）を当てた画像。from の画像に steps を順に当てる。二値化で終わるものは PNG、ほかは JPEG（品質 0.9。リポジトリを重くしない） */
const PRE: { file: string; from: string; steps: ("x2" | "bin" | "deskew")[]; label: string }[] = [
  { file: "bank-scan.x2.jpg", from: "bank-scan.jpg", steps: ["x2"], label: "拡大2倍" },
  { file: "bank-scan.bin.png", from: "bank-scan.jpg", steps: ["bin"], label: "二値化" },
  { file: "bank-scan.deskew.jpg", from: "bank-scan.jpg", steps: ["deskew"], label: "傾き直し" },
  { file: "card-photo.deskew.jpg", from: "card-photo.jpg", steps: ["deskew"], label: "傾き直し" },
  { file: "card-photo.bin.png", from: "card-photo.jpg", steps: ["bin"], label: "二値化" },
  { file: "card-photo.all.png", from: "card-photo.jpg", steps: ["deskew", "bin"], label: "傾き直し＋二値化" },
  { file: "card-small.x2.jpg", from: "card-small.png", steps: ["x2"], label: "拡大2倍" },
  { file: "card-small.x2bin.png", from: "card-small.png", steps: ["x2", "bin"], label: "拡大2倍＋二値化" },
  { file: "invoice-mobile.deskew.jpg", from: "invoice-mobile.jpg", steps: ["deskew"], label: "傾き直し" },
];

// ---- Chrome の canvas で描くページ ----
const PAGE = String.raw`
const SPEC = JSON.parse(document.getElementById("spec").textContent);
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function draw(doc) {
  const s = doc.scale;
  const c = canvas(Math.round(doc.width * s), Math.round(doc.height * s));
  const g = c.getContext("2d");
  g.fillStyle = doc.paper; g.fillRect(0, 0, c.width, c.height);
  g.scale(s, s);
  const items = [];
  for (const e of doc.els) {
    if (e.t === "rect") { g.fillStyle = e.fill; g.fillRect(e.x, e.y, e.w, e.h); }
    else if (e.t === "line") { g.strokeStyle = e.color || "#000"; g.lineWidth = e.width || 1; g.beginPath(); g.moveTo(e.x1, e.y1); g.lineTo(e.x2, e.y2); g.stroke(); }
    else {
      g.font = (e.weight || 400) + " " + e.size + "px " + (e.font || "sans-serif");
      g.fillStyle = e.color || "#000";
      const w = g.measureText(e.text).width;
      const x = e.align === "right" ? e.x - w : e.x;
      g.fillText(e.text, x, e.y);
      // 正解の文字の塊（PDF の向き: 下が 0・上向きが正。toLines() にそのまま渡せる形）
      items.push({ x, y: doc.height - e.y, width: w, size: e.size, text: e.text });
    }
  }
  return { c, items };
}
function effects(src, fx, seed) {
  const m = fx.margin || 0;
  const out = canvas(src.width + m * 2, src.height + m * 2);
  const g = out.getContext("2d");
  g.fillStyle = fx.desk || "#fff"; g.fillRect(0, 0, out.width, out.height);
  g.save();
  g.translate(out.width / 2, out.height / 2);
  g.rotate(((fx.rotate || 0) * Math.PI) / 180);
  if (fx.blur) g.filter = "blur(" + fx.blur + "px)";
  g.drawImage(src, -src.width / 2, -src.height / 2);
  g.restore();
  g.filter = "none";
  if (fx.light) {
    const lg = g.createLinearGradient(0, 0, out.width, out.height);
    lg.addColorStop(0, "rgba(255,255,255,0)");
    lg.addColorStop(0.55, "rgba(0,0,0," + fx.light * 0.25 + ")");
    lg.addColorStop(1, "rgba(0,0,0," + fx.light + ")");
    g.fillStyle = lg; g.fillRect(0, 0, out.width, out.height);
    const rg = g.createRadialGradient(out.width * 0.25, out.height * 0.2, 10, out.width * 0.25, out.height * 0.2, out.width * 0.5);
    rg.addColorStop(0, "rgba(255,250,235,0.35)"); rg.addColorStop(1, "rgba(255,250,235,0)");
    g.fillStyle = rg; g.fillRect(0, 0, out.width, out.height);
  }
  if (fx.noise || fx.gray || fx.fade) {
    const d = g.getImageData(0, 0, out.width, out.height);
    const r = rng(seed);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      let n = 0;
      if (fx.noise) { const u = r() + r() + r() - 1.5; n = u * fx.noise * 2; }
      for (let k = 0; k < 3; k++) {
        let v = fx.gray ? 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2] : p[i + k];
        if (fx.fade) v = 255 - (255 - v) * (1 - fx.fade);
        p[i + k] = Math.max(0, Math.min(255, v + n));
      }
    }
    g.putImageData(d, 0, 0);
  }
  return out;
}
function gray(c) {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  const out = new Float32Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return out;
}
// 二値化（明るさむらに強い、周りの平均との比べ方。Bradley の方法）
function darkMask(c) {
  const w = c.width, h = c.height, v = gray(c);
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += v[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const r = Math.max(8, Math.round(Math.min(w, h) / 40));
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
    const mean = sum / ((x1 - x0) * (y1 - y0));
    mask[y * w + x] = v[y * w + x] < mean * 0.85 ? 1 : 0;
  }
  return mask;
}
function bin(c) {
  const m = darkMask(c);
  const out = canvas(c.width, c.height);
  const g = out.getContext("2d");
  const d = g.createImageData(c.width, c.height);
  for (let i = 0; i < m.length; i++) { const v = m[i] ? 0 : 255; d.data[i * 4] = v; d.data[i * 4 + 1] = v; d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
  g.putImageData(d, 0, 0);
  return out;
}
function x2(c) {
  const out = canvas(c.width * 2, c.height * 2);
  const g = out.getContext("2d");
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(c, 0, 0, out.width, out.height);
  return out;
}
// 傾き直し: 暗い点を角度ごとに回して横に数え、行がいちばんくっきり分かれる角度（数の二乗の和が最大）を探す
const ANGLES = {};
function deskew(c, file) {
  const k = Math.min(1, 900 / Math.max(c.width, c.height));
  const small = canvas(Math.round(c.width * k), Math.round(c.height * k));
  small.getContext("2d").drawImage(c, 0, 0, small.width, small.height);
  const m = darkMask(small), w = small.width, h = small.height;
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) pts.push(x - w / 2, y - h / 2);
  let best = 0, bestScore = -1;
  for (let a = -8; a <= 8.0001; a += 0.1) {
    const t = (a * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t);
    const hist = new Float64Array(h * 2 + 10);
    for (let i = 0; i < pts.length; i += 2) { const yy = Math.round(pts[i + 1] * cs - pts[i] * sn + h); if (yy >= 0 && yy < hist.length) hist[yy]++; }
    let score = 0; for (const n of hist) score += n * n;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  ANGLES[file] = Math.round(best * 10) / 10;
  const out = canvas(c.width, c.height);
  const g = out.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, out.width, out.height);
  g.translate(out.width / 2, out.height / 2);
  g.rotate((-best * Math.PI) / 180);
  g.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}
// 1回目: 明細を描いて崩す（同期で終える。--dump-dom は待たない処理の終わりを待たないため）。
// 2回目: 1回目の画像を <img> で読み込んだページで、読み込みの後に前処理を当てる
function pass1() {
  const result = { images: {}, items: {} };
  SPEC.docs.forEach((doc, n) => {
    const { c, items } = draw(doc);
    result.items[doc.id] = items;
    const img = effects(c, doc.out.fx, 1000 + n);
    result.images[doc.out.file] = img.toDataURL(doc.out.type, doc.out.quality);
  });
  return result;
}
function pass2() {
  const result = { images: {}, angles: ANGLES };
  for (const p of SPEC.pre) {
    const im = document.querySelector('img[data-file="' + p.from + '"]');
    let c = canvas(im.naturalWidth, im.naturalHeight);
    c.getContext("2d").drawImage(im, 0, 0);
    for (const s of p.steps) c = s === "x2" ? x2(c) : s === "bin" ? bin(c) : deskew(c, p.file);
    result.images[p.file] = p.file.endsWith(".png") ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.9);
  }
  return result;
}
function run(f) {
  try { document.getElementById("out").textContent = JSON.stringify(f()); }
  catch (e) { document.getElementById("out").textContent = JSON.stringify({ error: String(e && e.stack || e) }); }
}
if (SPEC.pass === 1) run(pass1); else window.addEventListener("load", () => run(pass2));
`;

function chromePath(): string {
  if (process.env["CHROME"] !== undefined) return process.env["CHROME"];
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "win32") return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  return "google-chrome";
}

/** ページを Chrome で開き、読み込みの後の <pre id="out"> の JSON を返す */
function render(tmp: string, name: string, spec: unknown, extra = ""): Record<string, unknown> {
  const json = JSON.stringify(spec).replace(/</gu, "\\u003c");
  const html = `<!doctype html><meta charset="utf-8"><script type="application/json" id="spec">${json}</script>${extra}<pre id="out"></pre><script>${PAGE}</script>`;
  const page = join(tmp, name);
  writeFileSync(page, html);
  const r = spawnSync(chromePath(), ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(tmp, "profile")}`, "--dump-dom", pathToFileURL(page).href], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    timeout: 300_000,
  });
  // 終わるときの片付けで Chrome が 0 以外を返すことがある（macOS の Teardown watchdog）。結果が出ていれば使う
  const dom = r.stdout ?? "";
  const from = dom.indexOf('<pre id="out">');
  const to = dom.indexOf("</pre>", from);
  if (from < 0 || to < 0 || to === from + 14) throw new Error(`ページの結果がありません（Chrome の終わりのコード ${String(r.status)}）: ${r.stderr}`);
  const text = dom
    .slice(from + 14, to).replace(/&quot;/gu, '"').replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
  const out = JSON.parse(text) as Record<string, unknown>;
  if (typeof out["error"] === "string") throw new Error(out["error"]);
  return out;
}

function main(): void {
  const docs = [cardWeb(), cardPhone(), bankScan(), cardPhoto(), cardSmall(), invoicePower(), invoiceMobile()];
  // 描くページと Chrome の使い捨てのプロファイルは OS の一時フォルダに置く（消すのは OS に任せる）
  const tmp = mkdtempSync(join(tmpdir(), "ocr-images-"));
  const r1 = render(tmp, "draw.html", { pass: 1, docs }) as { images: Record<string, string>; items: Record<string, unknown[]> };
  const imgs = PRE.map((p) => p.from)
    .filter((f, i, a) => a.indexOf(f) === i)
    .map((f) => `<img data-file="${f}" src="${r1.images[f] as string}">`)
    .join("");
  const r2 = render(tmp, "pre.html", { pass: 2, pre: PRE }, imgs) as { images: Record<string, string>; angles: Record<string, number> };
  const all = { ...r1.images, ...r2.images };
  mkdirSync(DIR, { recursive: true });
  for (const [file, url] of Object.entries(all)) writeFileSync(join(DIR, file), Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
  const images = [
    ...docs.map((d) => ({ file: d.out.file, doc: d.id, label: d.out.label, pre: null })),
    ...PRE.map((p) => {
      const d = docs.find((x) => x.out.file === p.from) as Doc;
      return { file: p.file, doc: d.id, label: `${d.out.label}（${p.label}）`, pre: p.label, from: p.from };
    }),
  ];
  const truth = {
    note: "架空の明細の画像の正解（scripts/ocr-images.ts が作る。すべて架空）。items は描いた文字の塊（文字が完全に読めたときの toLines() への入力）",
    images,
    angles: r2.angles,
    docs: Object.fromEntries(docs.map((d) => [d.id, { label: d.label, kind: d.kind, rows: d.rows, items: r1.items[d.id] }])),
  };
  writeFileSync(join(DIR, "truth.json"), JSON.stringify(truth, null, 1) + "\n");
  console.log(`${Object.keys(all).length} 枚の画像と truth.json を ${DIR} に書きました（推し量った傾き: ${JSON.stringify(r2.angles)}）`);
}

main();
