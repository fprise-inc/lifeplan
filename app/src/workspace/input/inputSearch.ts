// 入力のホームの「探して開く」（作業の層）: 言葉を入れると、それを入れる入力項目の欄を探して開く。新しい物は作らず、入れる場所へ案内するだけ。
// - 探す対象は、各入力項目の段階の定義（stages/*.ts）の区画・まとまり・欄・ボタンの名前と説明、入力項目そのものの名前と案内の文、
//   言い換えの辞書（searchWords.ts）。世帯の今の中身から作る（子が2人なら、子の区画が2つ。物がまだ無ければ、その物を足すボタン）
// - 言葉は、ひらがな・カタカナ・全角半角・大文字小文字・空白と区切りの記号の違いをそろえてから比べる（foldText）
// - 結果は「入力項目の名前 › 欄の名前」と、どの物の欄か（区画・まとまりの名前。人の名前など）。同じ入力項目・同じ名前・同じ物は1つにまとめる
import type { Level, SectionDef, StageDef, StageId } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { itemStage, type InputItem } from "./items.ts";
import { SEARCH_WORDS, type SearchWord } from "./searchWords.ts";

/** 開いた後に移る所（欄・ボタン・まとまり・区画。card は入力項目の頭） */
export interface FindTarget {
  kind: "field" | "action" | "group" | "section" | "card";
  key: string;
  /** 移る所が見つからないとき（物の中の欄を閉じている画面など）に、代わりに移る区画 */
  section?: string;
}

export interface FindEntry {
  card: StageId;
  cardLabel: string;
  /** 欄・ボタン・まとまりの名前（画面のまま） */
  label: string;
  /** どの物の欄か（区画・まとまりの名前。入力項目の名前と同じなら null） */
  where: string | null;
  target: FindTarget;
  /** この入れ方でだけ出る所（詳細だけの欄は "detail"、標準だけの欄は "simple"）。どちらでも出るなら null */
  level: Level | null;
  /** 入力のホームに出していない入力項目（入力項目を選ぶで非表示にしてあり、値が入っていない） */
  hidden: boolean;
  /** そろえた文字（比べる用） */
  f: { label: string; where: string; help: string };
  /** 定義の並び（同じ点のときの順） */
  order: number;
}

export interface FindHit extends FindEntry {
  score: number;
}

/** 文字をそろえる: 全角半角（NFKC）・大文字小文字・カタカナ → ひらがな・空白と区切りの記号を外す */
export function foldText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・･、，,。．.＋+（）()「」『』【】［］[\]:：/／〜~―‐-]/g, "");
}

/** 1つの入力項目の段階の定義から、探す対象を作る */
export function entriesOf(stage: StageDef, card: { id: StageId; label: string; lead?: string; hidden: boolean }, start = 0): FindEntry[] {
  const out: FindEntry[] = [];
  const cardF = foldText(card.label);
  const push = (label: string, where: string | null, help: string | undefined, target: FindTarget, level: Level | null) => {
    if (label.trim() === "") return;
    const w = where !== null && where !== label && foldText(where) !== cardF ? where : null;
    out.push({ card: card.id, cardLabel: card.label, label, where: w, target, level, hidden: card.hidden, f: { label: foldText(label), where: w === null ? "" : foldText(w), help: help === undefined ? "" : foldText(help) }, order: start + out.length });
  };
  push(card.label, null, card.lead, { kind: "card", key: card.id }, null);
  for (const s of stage.sections) entriesOfSection(s, push);
  return out;
}

/**
 * 世帯の全部の入力項目（非表示の物も。入力のホームの並び）から、探す対象を作る。ピン（足した物）は物が属する入力項目の中で当たるので、別に作らない
 */
export function findEntries(wh: WorkingHousehold, items: readonly InputItem[]): FindEntry[] {
  const out: FindEntry[] = [];
  for (const i of items) {
    if (i.added !== null) continue;
    const stage = itemStage(wh, i.id);
    if (stage === null) continue;
    out.push(...entriesOf(stage, { id: i.id as StageId, label: i.label, lead: i.lead, hidden: i.hidden }, out.length));
  }
  return out;
}

/** 詳細だけ（どれかが detail）か */
const levelOf = (...ls: readonly Level[]): Level | null => (ls.includes("detail") ? "detail" : null);

/** 外す・取り消す操作（探して開く先にしない） */
const isRemoval = (label: string, danger: boolean | undefined) => danger === true || /外す$|を外す|入れない$/.test(label);

function entriesOfSection(s: SectionDef, push: (label: string, where: string | null, help: string | undefined, target: FindTarget, level: Level | null) => void) {
  const sec = { section: s.key };
  push(s.title, null, s.note, { kind: "section", key: s.key }, levelOf(s.level));
  const actions = (list: SectionDef["actions"], where: string, base: readonly Level[], simpleOnly: boolean) => {
    const choices = new Set<string>();
    for (const a of list) {
      if (isRemoval(a.label, a.danger)) continue;
      const lv = simpleOnly ? "simple" : levelOf(...base, a.level);
      if (a.choice === undefined) {
        push(a.label, where, a.help ?? a.title, { kind: "action", key: a.key, ...sec }, lv);
        continue;
      }
      // 1つの「＋」のボタンの中の選択肢: ボタンを1回。見出しのある一覧（保険の種類など）は、選択肢の名前でも探せる（開くのはボタン）
      if (!choices.has(a.choice.key)) {
        choices.add(a.choice.key);
        push(a.choice.label, where, a.choice.help, { kind: "action", key: a.choice.key, ...sec }, lv);
      }
      if (a.choice.group !== undefined) push(a.label, a.choice.label.replace(/^＋\s*/, ""), a.help, { kind: "action", key: a.choice.key, ...sec }, lv);
    }
  };
  for (const g of s.groups) {
    const simpleOnly = g.simpleOnly === true;
    // どの物の欄か: まとまりの題（区画の題を含まないとき〔「奨学金・教育ローン」など〕は、区画の題〔「第1子」〕を前に付けて、どの子の物か分かるように）
    const where = g.title === undefined ? s.title : g.title.includes(s.title) ? g.title : `${s.title} › ${g.title}`;
    if (g.title !== undefined) push(g.title, s.title, g.note ?? g.info?.text, { kind: "group", key: g.key, ...sec }, simpleOnly ? "simple" : levelOf(s.level, g.level));
    else if (g.info !== undefined) push(g.info.title, s.title, g.info.text, { kind: "group", key: g.key, ...sec }, levelOf(s.level, g.level));
    for (const f of g.fields) push(f.label, where, f.help, { kind: "field", key: f.key, ...sec }, simpleOnly || f.simpleOnly === true ? "simple" : levelOf(s.level, g.level, f.level));
    actions(g.actions, where, [s.level, g.level], simpleOnly);
  }
  actions(s.actions, s.title, [s.level], false);
}

/** 1件の点（0 は当たらない）。言い換えは別に足す */
function scoreOf(e: FindEntry, q: string): number {
  const l = e.f.label;
  let s = 0;
  if (l === q) s = 100;
  else if (l.startsWith(q)) s = 85;
  else if (l.includes(q)) s = 70;
  else if (e.f.where.includes(q)) s = 45;
  else if (q.length >= 2 && e.f.help.includes(q)) s = 25;
  return s === 0 ? 0 : s + bonus(e);
}

/** 同じ点のときに先に出す物: 入れる欄・まとまり（ボタンより先）、入力項目そのもの（名前で当たったとき） */
const bonus = (e: FindEntry): number => (e.target.kind === "card" ? 4 : e.target.kind === "field" || e.target.kind === "group" ? 3 : e.target.kind === "section" ? 2 : 0) + (e.level === "detail" ? 0 : 1);

/**
 * 言い換えの辞書の言い方が、入れた言葉に当たるか: 同じ（2）、言い方の始まりまで打った・言い方を含む長い言葉を打った（1）。
 * 1文字の言い方（「金」「親」など）は、同じときだけ当てる（「奨学金」「年金」に「金」を当てない）
 */
function wordHit(word: string, q: string): number {
  const w = foldText(word);
  if (w === q) return 2;
  if (q.length >= 2 && w.startsWith(q)) return 1;
  if (w.length >= 2 && q.includes(w)) return 1;
  return 0;
}

/** 言い換えの辞書から当たる物（入力項目の中の、探す言葉を含む欄。無ければ入力項目そのもの） */
function synonymHits(entries: readonly FindEntry[], q: string, words: readonly SearchWord[]): Map<FindEntry, number> {
  const out = new Map<FindEntry, number>();
  const put = (e: FindEntry, s: number) => out.set(e, Math.max(out.get(e) ?? 0, s));
  for (const w of words) {
    const hit = Math.max(...w.words.map((x) => wordHit(x, q)));
    if (hit === 0) continue;
    const inCard = entries.filter((e) => e.card === w.card);
    let found = false;
    (w.to ?? []).forEach((t, i) => {
      const tf = foldText(t);
      for (const e of inCard) {
        if (e.target.kind === "card" || !e.f.label.includes(tf)) continue;
        found = true;
        // 完全に打った言い方は、欄の名前で当たるのと同じくらい。前の言葉ほど先に
        put(e, (hit === 2 ? 90 : 75) - i * 2 + bonus(e));
      }
    });
    const head = inCard.find((e) => e.target.kind === "card");
    if (head !== undefined) put(head, found ? 40 : hit === 2 ? 80 : 60);
  }
  return out;
}

/** いくつまで出すか */
export const FIND_LIMIT = 8;
/** 同じ入力項目・同じ名前の欄（物ごとの「名義」など）は、いくつまで出すか */
const SAME_LABEL_LIMIT = 3;

/** 探す: 点の高い順に、同じ入力項目・同じ名前・同じ物は1つにして、limit 件まで */
export function findInInput(entries: readonly FindEntry[], query: string, words: readonly SearchWord[] = SEARCH_WORDS, limit = FIND_LIMIT): FindHit[] {
  const q = foldText(query);
  if (q === "") return [];
  const syn = synonymHits(entries, q, words);
  const scored: FindHit[] = [];
  for (const e of entries) {
    const score = Math.max(scoreOf(e, q), syn.get(e) ?? 0);
    if (score > 0) scored.push({ ...e, score });
  }
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const seen = new Set<string>();
  const perLabel = new Map<string, number>();
  const out: FindHit[] = [];
  for (const h of scored) {
    const k = `${h.card}|${h.f.label}|${h.f.where}`;
    if (seen.has(k)) continue;
    const lk = `${h.card}|${h.f.label}`;
    const n = perLabel.get(lk) ?? 0;
    if (n >= SAME_LABEL_LIMIT) continue;
    seen.add(k);
    perLabel.set(lk, n + 1);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}
