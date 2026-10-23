// テスト用の架空の明細（CSV・PDF）を作る（0034。すべて架空。実在の明細・他社のソフトの書き出しの形は写さない）。
// 列の名前・並びは、見出しの言葉の推し量りを確かめるために作った架空のもの。カード番号・口座番号も架空（0000 で始まる）。
//   node scripts/fixtures.ts          … test/fixtures/ に書く
//   node scripts/fixtures.ts --check  … 書いてあるものと同じかを確かめる
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const DIR = join(import.meta.dirname, "..", "test", "fixtures");

// ---- Shift_JIS の書き出し（TextDecoder で全部の2バイトの符号を読み、逆引きの表を作る） ----
let sjis: Map<string, number[]> | null = null;
function sjisTable(): Map<string, number[]> {
  if (sjis !== null) return sjis;
  const dec = new TextDecoder("shift_jis");
  const m = new Map<string, number[]>();
  for (let b = 0xa1; b <= 0xdf; b++) m.set(dec.decode(Uint8Array.of(b)), [b]);
  for (let hi = 0x81; hi <= 0xfc; hi++) {
    if (hi >= 0xa0 && hi <= 0xdf) continue;
    for (let lo = 0x40; lo <= 0xfc; lo++) {
      if (lo === 0x7f) continue;
      const ch = dec.decode(Uint8Array.of(hi, lo));
      if (ch.length === 1 && ch !== "�" && !m.has(ch)) m.set(ch, [hi, lo]);
    }
  }
  sjis = m;
  return m;
}
function toSjis(s: string): Uint8Array {
  const t = sjisTable();
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) out.push(c);
    else {
      const b = t.get(ch);
      if (b === undefined) throw new Error(`Shift_JIS にない文字: ${ch}`);
      out.push(...b);
    }
  }
  return Uint8Array.from(out);
}

const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/u.test(c) ? `"${c.replace(/"/gu, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
const utf8 = (s: string) => new TextEncoder().encode(s);
const bom = (s: string) => Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(s)]);
const yen = (n: number) => n.toLocaleString("en-US");
const pad = (n: number) => String(n).padStart(2, "0");

// ---- 1. カードの明細（UTF-8・BOM つき・12か月分。見出しの前に案内の行とカード番号の行がある） ----
function cardYear(): Uint8Array {
  const rows: string[][] = [
    ["【架空】サンプルカード ご利用明細"],
    ["カード番号", "0000-1111-2222-3333"],
    ["お客様番号：0009876543"],
    [],
    ["ご利用日", "ご利用店名", "ご利用者", "支払区分", "ご利用金額", "今回お支払金額", "お支払月"],
  ];
  for (let i = 0; i < 12; i++) {
    const y = 2025 + Math.floor((9 + i) / 12);
    const m = ((9 + i) % 12) + 1;
    const ym = `${y}/${pad(m)}`;
    const pay = `${m === 12 ? y + 1 : y}年${(m % 12) + 1}月`;
    rows.push([`${ym}/03`, "セブン－イレブン　架空一丁目店", "ご本人", "1回払い", yen(1280), yen(1280), pay]);
    rows.push([`${ym}/05`, "イオン 架空ショッピングセンター店", "ご本人", "1回払い", yen(18400 + i * 100), yen(18400 + i * 100), pay]);
    rows.push([`${ym}/10`, "ＮＴＴドコモ", "ご本人", "1回払い", yen(8800), yen(8800), pay]);
    rows.push([`${ym}/12`, "東京電力エナジーパートナー", "ご本人", "1回払い", yen(m >= 7 && m <= 9 ? 14200 : m <= 2 || m === 12 ? 16800 : 9600), "", pay]);
    rows.push([`${ym}/18`, "PAYPAY*架空カフェ", "ご家族", "1回払い", yen(640), yen(640), pay]);
    rows.push([`${ym}/22`, "架空ベーカリー　森の木", "ご本人", "1回払い", yen(2300), yen(2300), pay]);
  }
  rows.push(["2026/01/15", "ヤマダデンキ 架空店", "ご本人", "分割3回", yen(90000), yen(30000), "2026年2月"]);
  rows.push(["2026/02/01", "架空リボショップ", "ご本人", "リボ", yen(24000), yen(5000), "2026年3月"]);
  rows.push(["2026/03/20", "年会費", "ご本人", "1回払い", yen(11000), yen(11000), "2026年4月"]);
  rows.push(["2026/05/08", "自動車税（架空県）", "ご本人", "1回払い", yen(39500), yen(39500), "2026年6月"]);
  rows.push(["2026/06/02", "ユニクロ 架空店", "ご本人", "1回払い", yen(5990), yen(5990), "2026年7月"]);
  rows.push(["2026/06/09", "ユニクロ 架空店", "ご本人", "1回払い", "-5,990", "-5,990", "2026年7月"]);
  rows.push(["2026/07/14", "架空トラベル", "ご本人", "1回払い", yen(186000), yen(186000), "2026年8月"]);
  rows.push(["2026/08/30", "架空の謎の店", "ご本人", "1回払い", yen(4500), yen(4500), "2026年9月"]);
  rows.push(["2025/10/01", "架空保険料 年払", "ご本人", "1回払い", yen(62000), yen(62000), "2025年11月"]);
  rows.push([]);
  rows.push(["", "合計", "", "", "", yen(999999), ""]);
  return bom(csv(rows));
}

// ---- 2. 別のカード（Shift_JIS・半角カナ・列の並びが違う・月ごとの2つのファイル。分割の2回目と3回目の行がある） ----
function cardSjis(month: 5 | 6): Uint8Array {
  const rows: string[][] = [["利用日", "利用店名・商品名", "利用金額", "支払回数", "何回目", "支払金額", "備考"]];
  const pay = month === 5 ? "2" : "3";
  rows.push(["2026/04/20", "ｶｸｳﾃﾞﾝｷ ﾎﾝﾃﾝ", "60,000円", "3回", pay, "20,000円", ""]);
  rows.push([`2026/0${month}/02`, "ｾﾌﾞﾝｲﾚﾌﾞﾝ ｶｸｳｴｷﾏｴﾃﾝ", "540円", "1回", "", "540円", ""]);
  rows.push([`2026/0${month}/11`, "ﾏﾂﾓﾄｷﾖｼ ｶｸｳﾃﾝ", "2,180円", "1回", "", "2,180円", ""]);
  rows.push([`2026/0${month}/19`, "ｶｸｳｸﾘﾆﾂｸ", "3,300円", "1回", "", "3,300円", ""]);
  rows.push([`2026/0${month}/25`, "ｴﾈｵｽ ｶｸｳSS", "6,200円", "1回", "", "6,200円", "ｶｰﾄﾞ 0000111122223333"]);
  return toSjis(csv(rows));
}

// ---- 3. 銀行の明細（UTF-8・BOM なし。出金・入金の2列。カード会社への引き落とし・振込の相手の名前・口座番号の行） ----
function bank(): Uint8Array {
  const rows: string[][] = [["【架空】サンプル銀行 入出金明細"], ["口座番号 1234567"], ["日付", "摘要", "お引出し", "お預入れ", "残高"]];
  let bal = 800000;
  for (let i = 0; i < 12; i++) {
    const y = 2025 + Math.floor((9 + i) / 12);
    const m = ((9 + i) % 12) + 1;
    const d = (dd: number) => `${y}-${pad(m)}-${pad(dd)}`;
    bal += 320000;
    rows.push([d(25), "給与 カクウシヨウジ", "", yen(320000), yen(bal)]);
    bal -= 95000;
    rows.push([d(27), "家賃 架空不動産", yen(95000), "", yen(bal)]);
    bal -= 3800;
    rows.push([d(20), "水道局 架空市", yen(3800), "", yen(bal)]);
    bal -= 60000;
    rows.push([d(10), "ミツイスミトモカード", yen(60000), "", yen(bal)]);
    bal -= 30000;
    rows.push([d(15), "ATM 架空駅前", yen(30000), "", yen(bal)]);
  }
  rows.push(["2026-04-05", "振込 ヤマダ タロウ", yen(20000), "", yen(bal - 20000)]);
  rows.push(["2026-05-28", "固定資産税 架空市", yen(84000), "", yen(bal - 104000)]);
  rows.push(["2026-02-10", "ラクテンカード", yen(12000), "", yen(bal - 116000)]);
  return utf8(csv(rows));
}

// ---- 4. 家計簿アプリの書き出し（架空の列。支出がマイナス・分類・振替の印） ----
function app(): Uint8Array {
  const rows: string[][] = [["日付", "内容", "金額", "分類", "メモ", "振替"]];
  rows.push(["2026/09/01", "架空マルシェ", "-3,200", "食費", "", "0"]);
  rows.push(["2026/09/03", "架空ガス", "-5,400", "水道・光熱費", "", "0"]);
  rows.push(["2026/09/05", "口座振替（架空カード）", "-48,000", "カード引き落とし", "", "1"]);
  rows.push(["2026/09/10", "架空ブックス", "-1,650", "趣味・娯楽", "", "0"]);
  rows.push(["2026/09/25", "給与", "280,000", "収入", "", "0"]);
  rows.push(["2026/09/28", "架空ドラッグ", "-980", "日用品", "", "0"]);
  return bom(csv(rows));
}

// ---- 5. 見出しの無い TSV ----
function noHeader(): Uint8Array {
  const rows = [
    ["2026/09/01", "ローソン 架空店", "498"],
    ["2026/09/02", "架空食堂", "880"],
    ["2026/09/07", "ニトリ 架空店", "12,900"],
  ];
  return utf8(rows.map((r) => r.join("\t")).join("\n") + "\n");
}

// ---- 6. PDF（日本語の Type0 フォント＋ToUnicode。文字の並びはそのまま、位置で欄に分かれる） ----
interface Cell {
  x: number;
  text: string;
}
function pdf(lines: { y: number; cells: Cell[] }[], opts: { compress: boolean; objectStream: boolean }): Uint8Array {
  const chars = [...new Set(lines.flatMap((l) => l.cells.flatMap((c) => [...c.text])))].sort();
  const cid = new Map(chars.map((ch, i) => [ch, i + 1]));
  const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
  const utf16 = (ch: string) => [...ch].map((c) => { const u = c.codePointAt(0) as number; return u > 0xffff ? hex4(0xd800 + ((u - 0x10000) >> 10)) + hex4(0xdc00 + ((u - 0x10000) & 0x3ff)) : hex4(u); }).join("");
  let content = "";
  for (const l of lines) for (const c of l.cells) content += `BT /F1 9 Tf 1 0 0 1 ${c.x} ${l.y} Tm <${[...c.text].map((ch) => hex4(cid.get(ch) as number)).join("")}> Tj ET\n`;
  const cmapBody = chars.map((ch) => `<${hex4(cid.get(ch) as number)}> <${utf16(ch)}>`);
  let cmap = "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CMapName /Fixture-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
  for (let i = 0; i < cmapBody.length; i += 100) {
    const part = cmapBody.slice(i, i + 100);
    cmap += `${part.length} beginbfchar\n${part.join("\n")}\nendbfchar\n`;
  }
  cmap += "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n";
  const enc = (s: string) => new TextEncoder().encode(s);
  const stream = (dict: string, data: Uint8Array): Uint8Array[] => {
    const d = opts.compress ? new Uint8Array(deflateSync(data, { level: 9 })) : data;
    return [enc(`<< ${dict}${opts.compress ? " /Filter /FlateDecode" : ""} /Length ${d.length} >>\nstream\n`), d, enc("\nendstream")];
  };
  const objs: Record<number, Uint8Array[] | string> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    4: stream("", enc(content)),
    5: "<< /Type /Font /Subtype /Type0 /BaseFont /FixtureGothic /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
    6: "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /FixtureGothic /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>",
    7: stream("", enc(cmap)),
  };
  const parts: Uint8Array[] = [enc("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
  let offset = parts[0]?.length ?? 0;
  const xref: number[] = [];
  const put = (n: number, body: Uint8Array[] | string) => {
    xref[n] = offset;
    const chunk = [enc(`${n} 0 obj\n`), ...(typeof body === "string" ? [enc(body)] : body), enc("\nendobj\n")];
    for (const c of chunk) {
      parts.push(c);
      offset += c.length;
    }
  };
  let maxObj = 7;
  if (opts.objectStream) {
    // 辞書だけのオブジェクト（1・2・3・5・6）をオブジェクトストリームに入れる
    const inStream = [1, 2, 3, 5, 6];
    let head = "";
    let body = "";
    for (const n of inStream) {
      head += `${n} ${body.length} `;
      body += `${objs[n] as string}\n`;
    }
    const data = enc(head + body);
    put(4, objs[4] as Uint8Array[]);
    put(7, objs[7] as Uint8Array[]);
    put(8, stream(`/Type /ObjStm /N ${inStream.length} /First ${enc(head).length}`, data));
    maxObj = 8;
  } else for (let n = 1; n <= 7; n++) put(n, objs[n] as Uint8Array[] | string);
  const xrefAt = offset;
  let x = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxObj; n++) x += `${String(xref[n] ?? 0).padStart(10, "0")} 00000 ${xref[n] !== undefined ? "n" : "f"} \n`;
  x += `trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(enc(x));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of parts) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

function pdfStatement(): Uint8Array {
  const cols = [50, 130, 330, 400, 480];
  const lines: { y: number; cells: Cell[] }[] = [
    { y: 800, cells: [{ x: 50, text: "【架空】サンプルカード ご利用代金明細書" }] },
    { y: 780, cells: [{ x: 50, text: "カード番号 0000-1111-2222-4444" }] },
    { y: 760, cells: [{ x: 50, text: "2026年10月10日お支払い分" }] },
    { y: 730, cells: ["ご利用日", "ご利用店名", "支払区分", "ご利用金額", "お支払金額"].map((t, i) => ({ x: cols[i] as number, text: t })) },
  ];
  const data: [string, string, string, string, string][] = [
    ["2026/09/02", "ファミリーマート　架空店", "1回", "756", "756"],
    ["2026/09/06", "ガスト　架空店", "1回", "2,849", "2,849"],
    ["2026/09/14", "ソフトバンク", "1回", "6,578", "6,578"],
    ["2026/09/21", "ＥＮＥＯＳ　架空ＳＳ", "1回", "5,400", "5,400"],
    ["2026/09/27", "架空ホテル　湖畔", "1回", "48,000", "48,000"],
  ];
  data.forEach((r, k) => lines.push({ y: 710 - k * 18, cells: r.map((t, i) => ({ x: cols[i] as number, text: t })) }));
  lines.push({ y: 600, cells: [{ x: 130, text: "合計" }, { x: 480, text: "63,583" }] });
  return pdf(lines, { compress: true, objectStream: true });
}

function pdfLines(): Uint8Array {
  const lines: { y: number; cells: Cell[] }[] = [
    { y: 800, cells: [{ x: 50, text: "【架空】サンプル銀行 カード ご利用のお知らせ" }] },
    { y: 785, cells: [{ x: 50, text: "2026年1月10日お支払い分" }] },
    { y: 770, cells: [{ x: 50, text: "12/03 ローソン 架空店" }, { x: 400, text: "1回" }, { x: 480, text: "620" }] },
    { y: 752, cells: [{ x: 50, text: "12/15" }, { x: 90, text: "楽天モバイル" }, { x: 480, text: "3,278" }] },
    { y: 734, cells: [{ x: 50, text: "12/30" }, { x: 90, text: "架空スポーツクラブ" }, { x: 400, text: "分割3回" }, { x: 480, text: "33,000" }] },
  ];
  return pdf(lines, { compress: false, objectStream: false });
}

const FILES: Record<string, () => Uint8Array> = {
  "card-year-utf8bom.csv": cardYear,
  "card-sjis-2026-05.csv": () => cardSjis(5),
  "card-sjis-2026-06.csv": () => cardSjis(6),
  "bank-utf8.csv": bank,
  "app-utf8bom.csv": app,
  "card-noheader.tsv": noHeader,
  "card-statement.pdf": pdfStatement,
  "card-lines.pdf": pdfLines,
};

const check = process.argv.includes("--check");
let bad = 0;
for (const [name, make] of Object.entries(FILES)) {
  const p = join(DIR, name);
  const bytes = make();
  if (check) {
    if (!existsSync(p) || Buffer.compare(readFileSync(p), Buffer.from(bytes)) !== 0) {
      console.error(`作り直したものと違います: ${name}（node scripts/fixtures.ts で作り直す）`);
      bad++;
    }
  } else writeFileSync(p, bytes);
}
if (bad > 0) process.exit(1);
console.log(check ? `架空の明細 ${Object.keys(FILES).length} 個が作り直したものと同じ` : `架空の明細 ${Object.keys(FILES).length} 個を書いた`);
