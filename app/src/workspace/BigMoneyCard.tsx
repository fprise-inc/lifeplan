// 結果の画面の区画「夢と予定」（対策のすぐ下。0044・0103 の追記 2026-11-12）。前のグラフの上の切り替え（RowsViewBar）と
// 「ご家族の夢」の区画（GoalCards）を1つにまとめた。値は bigMoney.ts の bigMoneyOf。入れ外しは見方の切り替えで、保存しない（App.tsx の putRowsView）。
// 行の key は物の ID を含むので、提示層（presentation/）でなく作業の層に置く（0016 の2）。
// 並べ方（3列）: 物のあるまとまりだけを横に並べ、列の数はまとまりの数に合わせる。
// - まとまりが1つ: 読みやすい幅の表を1つ。7件以上なら、同じまとまりを左右2列に分けて並べる（年の順に左の列の上から）
// - 1つのまとまりが多い: 2つ以上のまとまりを並べるときは、まとまりごとに最初の8件だけを出し、残りは「ほか○件を見る」で開く
// - 区画の幅が狭いとき（区画の幅で切り替える。app.css）は、3列 → 2列 → 1列
// 選んでいるプランで外した物の行は、チェックを置かず薄くし、名前の下に「このプランでは外しています」（見出しの件数に数えない。0044 の追記 2026-11-14）
// 文（一行の結論・「?」・外した物の添え書き）は結果の画面の文の表（resultTexts.ts）、まとまり・列の名前・見込み・「ほか○件を見る」は
// 結果の画面の名前の表（resultTerms.ts）から出し、承認した事務所の文・名前を当てる（0212 の追記）。事務所の文・名前であることは画面に出さない
import type { ComponentChildren } from "preact";
import { useContext, useMemo, useState } from "preact/hooks";
import { Help } from "../presentation/Help.tsx";
import type { BigMoneyGroup, BigMoneyModel, BigMoneyPick, BigMoneyRow } from "./bigMoney.ts";
import { OfficeNamesContext, OfficeTextsContext } from "./office/customTextsContext.ts";
import { resultNamesOf, type ResultNames, type ResultTermId } from "./resultTerms.ts";
import { OFFICIAL_WORDING, wordingOf, type Wording } from "./resultTexts.ts";

/** 区画「夢と予定」の「?」の説明の段落の id（結果の画面の文の表の result:dreamsAndPlans/help…。0044・0103 の追記 2026-11-12・0212 の追記） */
const HELP_IDS = ["result:dreamsAndPlans/helpPick", "result:dreamsAndPlans/helpDefault", "result:dreamsAndPlans/helpNotSaved"] as const;

/** 「?」の説明の段落（事務所の文を承認していればその文） */
export const bigMoneyHelp = (w: Wording): string[] => HELP_IDS.map((id) => w.text(id));

/** 区画「夢と予定」の「?」の説明（公式の文） */
export const BIG_MONEY_HELP = bigMoneyHelp(OFFICIAL_WORDING);

/** 2つ以上のまとまりを並べるとき、まとまりごとに最初に出す件数（残りが2件以上なら「ほか○件を見る」で開く） */
export const BIG_MONEY_FOLD = 8;
/** まとまりが1つのとき、左右2列に分ける件数 */
export const BIG_MONEY_SPLIT = 7;

type OnPick = (pick: BigMoneyPick, include: boolean) => void;

/** まとまりの名前の id（名前の一覧の result:dreamsAndPlans/group…） */
const GROUP_TERM: Record<BigMoneyGroup["key"], ResultTermId> = { dreams: "result:dreamsAndPlans/groupDreams", pay: "result:dreamsAndPlans/groupPay", receive: "result:dreamsAndPlans/groupReceive" };

/** 区画の中で出す名前と文（事務所の名前・文を当てた物） */
interface Say {
  nm: ResultNames;
  w: Wording;
}

/** 行の右の見込みの名前 */
const tagName = (nm: ResultNames, tag: NonNullable<BigMoneyRow["tag"]>): string => nm(tag === "不確実" ? "result:dreamsAndPlans/tagUncertain" : "result:dreamsAndPlans/tagCertain");

export interface BigMoneyCardProps {
  model: BigMoneyModel;
  /** 子が返す貸与の奨学金の書き添え（PresentationModel の childRepaid） */
  notes: readonly string[];
  /** 1件を入れる（true）・外す（false） */
  onPick?: OnPick;
}

function Row({ r, dream, onPick, say }: { r: BigMoneyRow; dream: boolean; onPick: OnPick | undefined; say: Say }) {
  const tag = r.tag !== null ? tagName(say.nm, r.tag) : null;
  const cells = (
    <>
      <span class="bm-nm">
        {r.name}
        {r.removed === true ? <span class="bm-rm">{say.w.text("result:dreamsAndPlans/removedNote")}</span> : null}
      </span>
      <span class="bm-wh">{r.when}</span>
      <span class="bm-am num">{r.amount}</span>
      {dream ? null : <span class="bm-tg">{tag !== null ? <span class={`bm-t${r.tag === "不確実" ? " unsure" : ""}`}>{tag}</span> : null}</span>}
    </>
  );
  const cls = `bm-row${r.included ? "" : " off"}`;
  if (r.pick === null)
    return (
      <div class={`${cls} fixed${r.removed === true ? " removed" : ""}`} data-bm-row={r.key} data-included={r.included ? "1" : "0"} {...(r.removed === true ? { "data-bm-removed": "1" } : {})}>
        <span class="bm-ck" />
        {cells}
      </div>
    );
  const pick = r.pick;
  // 行の全体を押すとチェックが入れ外しされる（label）。読み上げは名前と見込み
  return (
    <label class={cls} data-bm-row={r.key} data-included={r.included ? "1" : "0"}>
      <span class="bm-ck">
        <input type="checkbox" checked={r.included} onChange={(e) => onPick?.(pick, (e.currentTarget as HTMLInputElement).checked)} aria-label={`${r.name}${tag !== null ? `（${tag}）` : ""}を計算に入れる`} />
      </span>
      {cells}
    </label>
  );
}

function Column({ g, rows, onPick, say, cont, more }: { g: BigMoneyGroup; rows: readonly BigMoneyRow[]; onPick: OnPick | undefined; say: Say; cont?: boolean; more?: ComponentChildren }) {
  const dream = g.key === "dreams";
  const title = say.nm(GROUP_TERM[g.key]);
  return (
    <div class={`bm-col${dream ? " nt" : ""}${cont === true ? " cont" : ""}`} data-bm-group={g.key} role="group" aria-label={title}>
      <div class="bm-gh">
        {/* 左右2列に分けた右の列は、まとまりの名前を繰り返さない（時期・金額の見出しだけ） */}
        <span class="bm-ttl">
          {cont === true ? null : (
            <>
              {title}
              <span class="bm-n">
                {g.included}/{g.count}件
              </span>
            </>
          )}
        </span>
        <span class="bm-h">{say.nm("result:dreamsAndPlans/columnWhen")}</span>
        <span class="bm-h r">{say.nm("result:dreamsAndPlans/columnAmount")}</span>
        {dream ? null : <span />}
      </div>
      {rows.map((r) => (
        <Row key={r.key} r={r} dream={dream} onPick={onPick} say={say} />
      ))}
      {more}
    </div>
  );
}

/**
 * 区画「夢と予定」（対策のすぐ下）: 頭は名前と「?」と一行の結論だけ。中身は「ご家族の夢」「支払いの予定」「受け取りの予定」を
 * 横に並べ、1件1行（チェック・名前・時期・金額・見込み）。並べる物が無ければ区画を出さない（子が返す奨学金の書き添えだけがあれば、それだけを出す）
 */
export function BigMoneyCard({ model, notes: noteTexts, onPick }: BigMoneyCardProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const office = useContext(OfficeTextsContext);
  const officeNames = useContext(OfficeNamesContext);
  const say = useMemo((): Say => ({ w: wordingOf(office), nm: resultNamesOf(officeNames) }), [office, officeNames]);
  const help = useMemo(() => bigMoneyHelp(say.w), [say]);
  const notes = noteTexts.map((t, i) => (
    <p class="bm-note" key={`c${i}`} data-child-repaid>
      {t}
    </p>
  ));
  if (model.groups.length === 0) return notes.length > 0 ? <div class="bm-notes">{notes}</div> : null;
  const one = model.groups.length === 1 ? model.groups[0]! : null;
  const split = one !== null && one.rows.length >= BIG_MONEY_SPLIT;
  let cols: ComponentChildren;
  if (one !== null) {
    const half = Math.ceil(one.rows.length / 2);
    cols = split
      ? [<Column key="a" g={one} rows={one.rows.slice(0, half)} onPick={onPick} say={say} />, <Column key="b" g={one} rows={one.rows.slice(half)} onPick={onPick} say={say} cont />]
      : [<Column key="a" g={one} rows={one.rows} onPick={onPick} say={say} />];
  } else {
    cols = model.groups.map((g) => {
      const foldable = g.rows.length > BIG_MONEY_FOLD + 1;
      const fold = foldable && open[g.key] !== true;
      const more = foldable ? (
        <button type="button" class="link-btn bm-more" aria-expanded={!fold} onClick={() => setOpen((o) => ({ ...o, [g.key]: fold }))} data-bm-more={g.key}>
          {fold ? `${say.nm("result:dreamsAndPlans/more", { count: `${String(g.rows.length - BIG_MONEY_FOLD)}件` })} ▾` : "閉じる ▴"}
        </button>
      ) : null;
      return <Column key={g.key} g={g} rows={fold ? g.rows.slice(0, BIG_MONEY_FOLD) : g.rows} onPick={onPick} say={say} more={more} />;
    });
  }
  const n = one !== null ? (split ? "s" : "1") : String(model.groups.length);
  return (
    <section class="card big-money" aria-label="夢と予定" data-big-money>
      <div class="card-h">
        <h2>夢と予定</h2>
        <Help label="夢と予定" id="big-money">
          {help.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </Help>
      </div>
      {model.line !== null ? (
        <p class="bm-line" data-big-money-line>
          {model.line}
        </p>
      ) : null}
      <div class={`bm-cols n${n}`} data-bm-cols={n}>
        {cols}
      </div>
      {notes}
    </section>
  );
}
