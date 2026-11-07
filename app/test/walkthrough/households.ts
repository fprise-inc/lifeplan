// 通しの入力の3つの世帯（人はすべて架空）: 画面のキー入力（押す・打つ・Tab・保存）で、世帯を選ぶ → 空から作る → 入力項目を順に入れる。
// 途中で見たい物（推定の値・欄の値・パネルの文字）は notes に残し、テスト（walkthrough.test.ts）が世帯の中身・計算の結果と合わせて確かめる。
// ① 会社員の夫婦（38歳・36歳）と子2人（6歳・3歳）、持ち家（住宅ローンあり）。ざっくり（標準の欄だけ）
// ② 自営業のひとり親（42歳・女性。青色申告で65万円の控除）と子1人（15歳）、賃貸、国民年金・国保。詳しく（詳細も使う）
// ③ 60代の夫婦（63歳・60歳）、再雇用・企業年金、持ち家は完済、区分マンション1室を貸す、母の介護と相続の見込み。詳しく
// ④ 賃貸から住宅を買う予定の人（40歳）。購入の時期を画面で直して、前の賃貸の住み終わり・住宅ローンの借入の年月・控除の入居がついてくるか（標準の欄だけ）
import type { Page } from "./browser.ts";

export interface Notes {
  /** 開いたパネルの文字（入力項目の名前 → 文字） */
  panels: Record<string, string>;
  /** 途中で読んだ値 */
  seen: Record<string, string>;
}

const newNotes = (): Notes => ({ panels: {}, seen: {} });

/** 入力のホームの入力項目の札を押してパネルを開き、パネルの文字を残す */
async function open(p: Page, n: Notes, card: string, level: "標準" | "詳細" = "標準"): Promise<void> {
  await p.click(card, { exact: false });
  await p.until("w.panel()", `${card}のパネルが開く`);
  await p.click(level, { within: "panel", exact: true });
  n.panels[card] = await p.panelText();
}

/** 保存してパネルを閉じる。閉じる前のパネルの文字も残す（足した物の欄を含む） */
async function save(p: Page, n: Notes, card: string): Promise<void> {
  n.panels[`${card}（保存の前）`] = await p.panelText();
  await p.click("保存", { within: "panel", exact: true });
  await p.until("!w.panel()", `${card}のパネルが閉じる`);
}

/** ホームの入力項目の札の文字 */
const cardText = (p: Page, card: string) => p.eval<string>(`return w.all("button").map(w.txt).find((t) => t.startsWith(${JSON.stringify(card)})) ?? ""`);

/** パネルの中の欄の今の値（欄の名前で探す。nth は同じ名前の何番目か） */
const fieldValue = (p: Page, label: string, nth = 0) => p.eval<string>(`const f = w.all(".fld", w.panel()).filter((x) => w.txt(x).startsWith(${JSON.stringify(label)}))[${nth}]; return f?.querySelector("input,select")?.value ?? "（欄なし）"`);

/** 上の帯の世帯の名前（「見本 3-4-01 …▼」「0001 …▼」）を押して、世帯を選ぶ画面を開く。開いた直後は描き直しで外れることがあるので、開くまで押し直す */
async function openPicker(p: Page): Promise<void> {
  // 前の世帯の途中で落ちたときに開いたままのパネルを閉じる（入れかけの変更は捨てる）
  if (await p.eval<boolean>("return !!w.panel()")) {
    await p.click("キャンセル", { within: "panel", exact: true }).catch(() => undefined);
    if (await p.eval<boolean>(`return w.all("button").some((b) => w.txt(b) === "変更を捨てて閉じる")`)) await p.click("変更を捨てて閉じる", { exact: true });
  }
  for (let i = 0; ; i++) {
    // 初めての起動で先に出る問い（復元キーの保管）は「あとで」
    if (await p.eval<boolean>(`return w.all("button").some((b) => w.txt(b) === "あとで")`)) await p.click("あとで", { exact: true });
    const head = await p.eval<string>(`return w.all("header button").map(w.txt).find((t) => /[▼▲]$/.test(t)) ?? ""`);
    if (head !== "") await p.click(head, { exact: true });
    try {
      await p.until(`w.dialog() && w.txt(w.dialog()).startsWith("世帯を選ぶ")`, "世帯を選ぶ", 8_000);
      return;
    } catch (e) {
      if (i >= 3) throw new Error(`${String(e)}（上に出ている物: ${await p.eval<string>(`const pt = (() => { const b = w.all("header button").find((x) => /[▼▲]$/.test(w.txt(x))); if (!b) return null; const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); })(); return pt ? (pt.className + " " + w.txt(pt).slice(0, 200)) : "なし"`)}）`, { cause: e });
    }
  }
}

/** 世帯を選ぶ → 空から作る → 入力のタブ。初めての起動の問い（区分を使うか・復元キー）は「使わない」「あとで」 */
export async function newHousehold(p: Page): Promise<void> {
  await openPicker(p);
  if (await p.eval<boolean>(`return w.txt(w.dialog()).includes("区分を使いますか")`)) await p.click("使わない（通し番号だけ）", { within: "dialog" });
  await p.click("空から作る", { within: "dialog" });
  if (await p.eval<boolean>(`return w.all("[role=dialog]").some((d) => w.txt(d).startsWith("復元キー"))`)) await p.click("あとで", { within: "dialog", exact: true });
  await p.click("入力", { exact: true });
  await p.until(`w.all("button").some((b) => w.txt(b).startsWith("家族"))`, "入力のホーム");
}

/** 見本の棚の世帯を開く（見本番号で） */
export async function openSample(p: Page, no: string): Promise<void> {
  await openPicker(p);
  await p.click("見本（", { within: "dialog" });
  await p.click("開く", { within: "dialog", row: no, exact: true });
  await p.click("入力", { exact: true });
  await p.until(`w.all("button").some((b) => w.txt(b).startsWith("家族"))`, "入力のホーム");
}

/** 開いている世帯の、入力のホームの全部の入力項目のパネルを開いて閉じる（見本の通し。パネルの文字を残す） */
export async function walkPanels(p: Page, level: "標準" | "詳細"): Promise<Notes> {
  const n = newNotes();
  const cards = await p.eval<string[]>(`return w.all("main button").map(w.txt).filter((t) => /^(家族|働き方と収入|退職金・企業年金|年金|基本生活費|子ども・教育|住まい・ローン|保険|貯蓄・運用|収益不動産|ライフイベント|車|介護・親|相続・贈与|前提条件) /.test(t)).map((t) => t.split(" ")[0])`);
  for (const c of [...new Set(cards)]) {
    await open(p, n, c, level);
    await p.click("キャンセル", { within: "panel", exact: true });
    await p.until("!w.panel()", `${c}のパネルが閉じる`);
  }
  return n;
}

export async function household1(p: Page): Promise<Notes> {
  const n = newNotes();
  await newHousehold(p);
  await open(p, n, "家族");
  await p.type("生年月", "1988-05");
  await p.click("＋ 配偶者", { within: "panel" });
  await p.click("＋ 子", { within: "panel", exact: true });
  await p.click("＋ 子", { within: "panel", exact: true });
  await p.type("生年月", "1990-08", { nth: 1 });
  // 打っている間は子を並び替えない（保存のときに生年月の順に並べる。0141）ので、上の子から順に入れる
  await p.type("生年月", "2020-06", { nth: 2 });
  await p.type("生年月", "2023-02", { nth: 3 });
  await save(p, n, "家族");

  await open(p, n, "働き方と収入");
  // 働き方の入口は「働き方を入れる」の1つのボタンの中の選択肢
  await p.click("働き方を入れる", { within: "panel", exact: true });
  await p.click("正社員", { within: "panel", exact: true });
  await p.click("働き方を入れる", { within: "panel", exact: true });
  await p.click("正社員", { within: "panel", exact: true });
  await p.type("年収（税込み・賞与込み）", "550");
  await p.type("年収（税込み・賞与込み）", "400", { nth: 1 });
  await save(p, n, "働き方と収入");

  await open(p, n, "基本生活費");
  await p.type("基本生活費（月額）", "30");
  await save(p, n, "基本生活費");

  await open(p, n, "子ども・教育");
  await save(p, n, "子ども・教育");

  await open(p, n, "住まい・ローン");
  await p.click("＋ 持ち家（今住んでいる）", { within: "panel" });
  // 評価額は未入力の警告なので、入るまで標準に出る（入れないと今の家が資産に入らない）
  await p.type("評価額", "3500");
  await p.click("＋ 住宅ローン", { within: "panel", exact: true });
  await p.type("今の残高", "2800");
  // 毎月の返済額は円の欄（返済予定表の数字をそのまま打つ。「9万」も9万円）
  await p.type("毎月の返済額", "9万");
  await p.type("完済の年月", "2058-03");
  // 借りた年月は今の残高から入れたローンの標準の欄（控除の入居・持ち家の住み始めにも使う）。入れても、入れた返済額・完済の年月は変わらない
  await p.type("借りた年月（入居の年月）", "2023-04");
  n.seen.loanPaymentAfterStart = await fieldValue(p, "毎月の返済額");
  n.seen.loanPayoffAfterStart = await fieldValue(p, "完済の年月");
  await save(p, n, "住まい・ローン");

  await open(p, n, "保険");
  await p.click("＋ 保険契約を足す", { within: "panel", exact: true });
  await p.click("収入保障保険", { within: "panel", exact: true });
  await p.type("保険料（月額）", "4500");
  // 円の欄に「15万」と打つ（ざっくり派がよく打つ形）
  await p.type("年金月額", "15万");
  n.seen.annuityTyped = await fieldValue(p, "年金月額");
  await save(p, n, "保険");

  await open(p, n, "貯蓄・運用");
  await p.click("＋ 預金", { within: "panel", exact: true });
  await p.click("＋ NISA", { within: "panel", exact: true });
  await p.type("預金の残高", "500");
  await p.type("NISAの残高", "200");
  await p.type("NISA つみたて投資枠の1つ目の期間の毎月の積立", "3");
  await save(p, n, "貯蓄・運用");

  await open(p, n, "車");
  await p.click("＋ 今の車", { within: "panel", exact: true });
  await save(p, n, "車");
  return n;
}

export async function household2(p: Page): Promise<Notes> {
  const n = newNotes();
  await newHousehold(p);
  await open(p, n, "家族", "詳細");
  await p.click("＋ 子", { within: "panel", exact: true });
  await p.click("＋ 養育費を受け取る", { within: "panel", exact: true });
  // ひとり親の世帯では「＋ 児童扶養手当など」の名前（足す行は手当・給付金。0141）
  await p.click("＋ 児童扶養手当など", { within: "panel", exact: true });
  await p.type("生年月", "1984-06");
  await p.choose("性別", "女性");
  await p.type("生年月", "2011-07", { nth: 1 });
  // 始まりは足したときのまま（直さない）
  n.seen.childSupportFrom = await fieldValue(p, "始まり", 0);
  await p.type("月額", "3");
  await p.type("月額", "1", { nth: 1 });
  await save(p, n, "家族");

  await open(p, n, "働き方と収入", "詳細");
  await p.click("働き方を入れる", { within: "panel", exact: true });
  await p.click("自営業", { within: "panel", exact: true });
  await p.type("事業所得（年額）", "350");
  // 確定申告（事業所得のある人の申告の仕方と青色申告特別控除。収益不動産の「申告」と同じ値。0155）
  await p.choose("申告の仕方", "青色");
  await p.choose("青色申告特別控除", "65万円");
  await p.type("働く最後の年齢", "70");
  await save(p, n, "働き方と収入");

  await open(p, n, "年金", "詳細");
  n.seen.pensionCard = await cardText(p, "年金");
  await save(p, n, "年金");

  await open(p, n, "基本生活費", "詳細");
  await p.choose("入れ方", "内訳で");
  await p.type("食費", "6");
  await p.type("通信費", "1.5");
  await save(p, n, "基本生活費");

  await open(p, n, "子ども・教育", "詳細");
  await p.choose("通い方", "自宅外（下宿・寮）");
  await p.click("＋ 貸与の奨学金", { within: "panel", exact: true });
  await p.type("月額", "5");
  await save(p, n, "子ども・教育");

  await open(p, n, "住まい・ローン", "詳細");
  await p.click("＋ 賃貸", { within: "panel", exact: true });
  await p.type("家賃（管理費込み）", "7.5");
  await p.type("更新料（家賃の何か月分）", "1");
  await save(p, n, "住まい・ローン");

  await open(p, n, "保険", "詳細");
  await p.click("＋ 保険契約を足す", { within: "panel", exact: true });
  await p.click("定期保険", { within: "panel", exact: true });
  await p.type("保険料（月額）", "3200");
  await p.type("死亡保険金", "1000");
  await save(p, n, "保険");

  await open(p, n, "貯蓄・運用", "詳細");
  await p.click("＋ 預金", { within: "panel", exact: true });
  await p.click("＋ iDeCo", { within: "panel", exact: true });
  await p.click("＋ 小規模企業共済", { within: "panel", exact: true });
  await p.type("預金の残高", "200");
  await p.type("iDeCoの残高", "80");
  await p.type("iDeCoの1つ目の期間の毎月の積立", "2.3");
  await p.type("小規模企業共済の残高", "150");
  await p.type("小規模企業共済の1つ目の期間の毎月の積立", "3");
  await save(p, n, "貯蓄・運用");

  await open(p, n, "前提条件", "詳細");
  await p.click("キャンセル", { within: "panel", exact: true });
  return n;
}

export async function household3(p: Page): Promise<Notes> {
  const n = newNotes();
  await newHousehold(p);
  await open(p, n, "家族", "詳細");
  await p.click("＋ 配偶者", { within: "panel" });
  await p.click("＋ 子", { within: "panel", exact: true });
  await p.click("＋ 子", { within: "panel", exact: true });
  await p.type("生年月", "1963-04");
  await p.type("生年月", "1966-03", { nth: 1 });
  await p.type("生年月", "1992-06", { nth: 2 });
  await p.type("生年月", "1995-09", { nth: 3 });
  await save(p, n, "家族");

  await open(p, n, "働き方と収入");
  // ご本人（63歳）は今の働き方の再雇用から（定年の前の正社員も作る）。配偶者は正社員で入れてからパートに変える
  await p.click("働き方を入れる", { within: "panel", exact: true });
  await p.click("契約社員・嘱託（再雇用など）", { within: "panel", exact: true });
  await p.click("働き方を入れる", { within: "panel", exact: true });
  await p.click("正社員", { within: "panel", exact: true });
  n.seen.spouseAnnualBefore = await fieldValue(p, "年収（税込み・賞与込み）", 1);
  await p.choose("働き方", "パート・アルバイト", { nth: 1 });
  n.seen.spouseAnnualPart = await fieldValue(p, "年収（税込み・賞与込み）", 1);
  await p.type("年収（税込み・賞与込み）", "350");
  await p.type("年収（税込み・賞与込み）", "100", { nth: 1 });
  await save(p, n, "働き方と収入");

  // 定年の後の再雇用の人・パートに変えた人には、目安の退職一時金は足されない（受け取りが過去・パートの勤め先）。企業年金を足す
  await open(p, n, "退職金・企業年金", "詳細");
  n.seen.retirementCard = await cardText(p, "退職金・企業年金");
  // 「＋ 退職金・企業年金を足す」は種類を選んでから足す（0141）
  await p.click("＋ 退職金・企業年金を足す", { within: "panel", exact: true });
  await p.click("確定給付企業年金（企業年金基金・企業年金連合会を含む）", { within: "panel", exact: true });
  await p.choose("受け取り方", "年金");
  await p.choose("勤め先", "正社員");
  await p.type("年金の年額", "60");
  await p.type("年金の始まり", "65");
  await save(p, n, "退職金・企業年金");
  n.seen.retirementCardAfter = await cardText(p, "退職金・企業年金");

  n.seen.pensionCardBefore = await cardText(p, "年金");
  await open(p, n, "年金", "詳細");
  await p.choose("年金の入れ方", "書類から");
  await p.type("国民年金の加入月数", "480");
  await p.type("厚生年金の加入月数", "498");
  // 書類から写す年金の額は円の欄（書類の数字をそのまま打つ。0141）
  await p.type("老齢基礎年金（65歳からの見込額）", "816000");
  await p.type("老齢厚生年金（65歳からの見込額）", "1230000");
  await p.choose("年金の入れ方", "書類から", { nth: 1 });
  await p.type("国民年金の加入月数", "480", { nth: 1 });
  await p.type("厚生年金の加入月数", "456", { nth: 1 });
  await p.type("老齢基礎年金（65歳からの見込額）", "816,000", { nth: 1 });
  await p.type("老齢厚生年金（65歳からの見込額）", "90万", { nth: 1 });
  await save(p, n, "年金");
  n.seen.pensionCardAfter = await cardText(p, "年金");

  await open(p, n, "住まい・ローン", "詳細");
  await p.click("＋ 持ち家（今住んでいる）", { within: "panel" });
  await p.type("評価額", "3000");
  await p.type("建物が建った年", "1995");
  await p.type("住み始め", "1995-10");
  await save(p, n, "住まい・ローン");

  await open(p, n, "収益不動産", "詳細");
  await p.click("＋ 物件を足す", { within: "panel", exact: true });
  await p.choose("種類", "区分マンション");
  await p.type("今の評価額（土地と建物の合計）", "1500");
  await p.choose("建物の構造", "鉄筋コンクリート造");
  await p.type("建物が建った年", "2008");
  await p.type("取得価額（土地と建物の合計）", "1800");
  await p.type("取得の年月", "2010-04");
  // 取得の年月を打ち直すつもりで Backspace で消す（打つ途中の空）
  await p.clear("取得の年月");
  n.seen.acquisitionAfterClear = await fieldValue(p, "取得価額（土地と建物の合計）");
  await p.type("取得価額（土地と建物の合計）", "1800");
  await p.type("取得の年月", "2010-04");
  await p.type("満室時の家賃（合計）", "7");
  await p.type("空室率", "5");
  await p.type("管理委託料など（家賃に対する割合）", "5");
  await p.type("建物管理費・修繕積立金", "18");
  await p.type("固定資産税・都市計画税", "5");
  await save(p, n, "収益不動産");

  await open(p, n, "介護・親", "詳細");
  // 配偶者のいる世帯: 「＋ ご本人の親を足す」を押して「母」を選ぶ（父・母・父母から選ぶ）
  await p.click("＋ ご本人の親を足す", { within: "panel", exact: true });
  await p.click("母", { within: "panel", exact: true });
  await p.type("生年月", "1937-06");
  await p.click("＋ 母の介護を推定で入れる", { within: "panel", exact: true });
  await p.choose("払う人", "世帯（ご本人）");
  await p.type("月々の費用（自己負担の合計）", "8");
  await save(p, n, "介護・親");

  await open(p, n, "相続・贈与", "詳細");
  await p.click("＋ 相続・遺贈", { within: "panel", exact: true });
  await p.type("額", "1500");
  n.seen.inheritWhenBefore = await fieldValue(p, "時期");
  await save(p, n, "相続・贈与");

  // 母の亡くなる見込みを直す（相続の時期・介護の終わりがついてくるか）。生年月を入れた時点で平均余命の推定（89歳の母は95歳ごろ）が入るので、
  // それと違う年齢にする
  await open(p, n, "介護・親", "詳細");
  await p.type("亡くなる見込み", "92");
  await save(p, n, "介護・親");
  await open(p, n, "相続・贈与", "詳細");
  n.seen.inheritWhenAfter = await fieldValue(p, "時期");
  await p.click("キャンセル", { within: "panel", exact: true });

  await open(p, n, "貯蓄・運用");
  await p.click("＋ 預金", { within: "panel", exact: true });
  await p.click("＋ 課税口座", { within: "panel", exact: true });
  await p.type("預金の残高", "2500");
  await p.type("課税口座（特定口座）の残高", "800");
  await p.type("課税口座（特定口座）の利回り", "3");
  await save(p, n, "貯蓄・運用");
  return n;
}

/**
 * ④ 賃貸から住宅を買う予定。購入の時期を画面のキー入力で2回直す（住宅ローンを足す前と後）。どちらも、前の賃貸の住み終わり・購入した家の住み始め・
 * 住宅ローンの借入の年月と控除の入居がついてくるか（時点の欄は欄を離れたときに決める。決めた値が連動を通るか）。最後に借入の年月だけを手で
 * ずらし、借入額の欄の下の「購入の時期に合わせる」を押して戻す（欄の下の知らせのボタン）
 */
export async function household4(p: Page): Promise<Notes> {
  const n = newNotes();
  await newHousehold(p);
  await open(p, n, "家族");
  await p.type("生年月", "1986-05");
  await save(p, n, "家族");

  await open(p, n, "住まい・ローン");
  await p.click("＋ 賃貸", { within: "panel", exact: true });
  await p.type("家賃（管理費込み）", "10");
  await p.click("＋ 住宅購入の予定", { within: "panel", exact: true });
  // 住宅ローンを足す前に直す
  await p.type("購入の時期", "2030-04");
  n.seen.rentEndAfterFirst = await fieldValue(p, "住み終わり");
  await p.click("＋ 住宅ローン", { within: "panel", exact: true });
  n.seen.loanStartAfterAdd = await fieldValue(p, "借入の年月");
  // 住宅ローンを足した後に直す
  await p.type("購入の時期", "2031-10");
  n.seen.rentEndAfterSecond = await fieldValue(p, "住み終わり");
  n.seen.loanStartAfterSecond = await fieldValue(p, "借入の年月");
  n.seen.purchasePanel = await p.panelText();
  await save(p, n, "住まい・ローン");

  // 借入の年月だけを手でずらすと、借入額の欄の下に知らせと「購入の時期に合わせる」が出る。押すと借入の年月が購入の時期に戻る
  await open(p, n, "住まい・ローン");
  await p.type("借入の年月", "2032-01");
  n.seen.gapPanel = await p.panelText();
  await p.click("購入の時期に合わせる", { within: "panel", exact: true });
  n.seen.loanStartAfterFix = await fieldValue(p, "借入の年月");
  await save(p, n, "住まい・ローン");
  return n;
}
