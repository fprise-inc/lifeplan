// 結果の画面の区画「これからの大きなお金」（結果のグラフのすぐ下。0044・0103 の追記 2026-11-12）。前のグラフの上の切り替え（RowsViewBar）と
// 「ご家族の夢」の区画（GoalCards）を1つにまとめた。値は bigMoney.ts の bigMoneyOf。入れ外しは見方の切り替えで、保存しない（App.tsx の putRowsView）。
// 行の key は物の ID を含むので、提示層（presentation/）でなく作業の層に置く（0016 の2）。
// 並べ方（3列）: 物のあるまとまりだけを横に並べ、列の数はまとまりの数に合わせる。
// - まとまりが1つ: 読みやすい幅の表を1つ。7件以上なら、同じまとまりを左右2列に分けて並べる（年の順に左の列の上から）
// - 1つのまとまりが多い: 2つ以上のまとまりを並べるときは、まとまりごとに最初の8件だけを出し、残りは「ほか○件を見る」で開く
// - 区画の幅が狭いとき（区画の幅で切り替える。app.css）は、3列 → 2列 → 1列
import type { ComponentChildren } from "preact";
import { useContext, useMemo, useState } from "preact/hooks";
import { Help } from "../presentation/Help.tsx";
import type { BigMoneyGroup, BigMoneyModel, BigMoneyPick, BigMoneyRow } from "./bigMoney.ts";
import { OfficeTextsContext } from "./office/customTextsContext.ts";
import { OFFICIAL_WORDING, wordingOf, type Wording } from "./resultTexts.ts";

/** 区画「これからの大きなお金」の「?」の説明の段落の id（結果の画面の文の表の result:bigMoney/help…。0044・0103 の追記 2026-11-12・0212 の追記） */
const HELP_IDS = ["result:bigMoney/helpPick", "result:bigMoney/helpDefault", "result:bigMoney/helpNotSaved"] as const;

/** 「?」の説明の段落（事務所の文を承認していればその文） */
export const bigMoneyHelp = (w: Wording): string[] => HELP_IDS.map((id) => w.text(id));

/** 区画「これからの大きなお金」の「?」の説明（公式の文） */
export const BIG_MONEY_HELP = bigMoneyHelp(OFFICIAL_WORDING);

/** 2つ以上のまとまりを並べるとき、まとまりごとに最初に出す件数（残りが2件以上なら「ほか○件を見る」で開く） */
export const BIG_MONEY_FOLD = 8;
/** まとまりが1つのとき、左右2列に分ける件数 */
export const BIG_MONEY_SPLIT = 7;

type OnPick = (pick: BigMoneyPick, include: boolean) => void;

export interface BigMoneyCardProps {
  model: BigMoneyModel;
  /** 子が返す貸与の奨学金の書き添え（PresentationModel の childRepaid） */
  notes: readonly string[];
  /** 1件を入れる（true）・外す（false） */
  onPick?: OnPick;
}

function Row({ r, dream, onPick }: { r: BigMoneyRow; dream: boolean; onPick: OnPick | undefined }) {
  const cells = (
    <>
      <span class="bm-nm">{r.name}</span>
      <span class="bm-wh">{r.when}</span>
      <span class="bm-am num">{r.amount}</span>
      {dream ? null : <span class="bm-tg">{r.tag !== null ? <span class={`bm-t${r.tag === "不確実" ? " unsure" : ""}`}>{r.tag}</span> : null}</span>}
    </>
  );
  const cls = `bm-row${r.included ? "" : " off"}`;
  if (r.pick === null)
    return (
      <div class={`${cls} fixed`} data-bm-row={r.key} data-included="1">
        <span class="bm-ck" />
        {cells}
      </div>
    );
  const pick = r.pick;
  // 行の全体を押すとチェックが入れ外しされる（label）。読み上げは名前と見込み
  return (
    <label class={cls} data-bm-row={r.key} data-included={r.included ? "1" : "0"}>
      <span class="bm-ck">
        <input type="checkbox" checked={r.included} onChange={(e) => onPick?.(pick, (e.currentTarget as HTMLInputElement).checked)} aria-label={`${r.name}${r.tag !== null ? `（${r.tag}）` : ""}を計算に入れる`} />
      </span>
      {cells}
    </label>
  );
}

function Column({ g, rows, onPick, cont, more }: { g: BigMoneyGroup; rows: readonly BigMoneyRow[]; onPick: OnPick | undefined; cont?: boolean; more?: ComponentChildren }) {
  const dream = g.key === "dreams";
  return (
    <div class={`bm-col${dream ? " nt" : ""}${cont === true ? " cont" : ""}`} data-bm-group={g.key} role="group" aria-label={g.title}>
      <div class="bm-gh">
        {/* 左右2列に分けた右の列は、まとまりの名前を繰り返さない（時期・金額の見出しだけ） */}
        <span class="bm-ttl">
          {cont === true ? null : (
            <>
              {g.title}
              <span class="bm-n">
                {g.included}/{g.rows.length}件
              </span>
            </>
          )}
        </span>
        <span class="bm-h">時期</span>
        <span class="bm-h r">金額</span>
        {dream ? null : <span />}
      </div>
      {rows.map((r) => (
        <Row key={r.key} r={r} dream={dream} onPick={onPick} />
      ))}
      {more}
    </div>
  );
}

/**
 * 区画「これからの大きなお金」（結果のグラフのすぐ下）: 頭は名前と「?」と一行の結論だけ。中身は「ご家族の夢」「支払いの予定」「受け取りの予定」を
 * 横に並べ、1件1行（チェック・名前・時期・金額・見込み）。並べる物が無ければ区画を出さない（子が返す奨学金の書き添えだけがあれば、それだけを出す）
 */
export function BigMoneyCard({ model, notes: noteTexts, onPick }: BigMoneyCardProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const office = useContext(OfficeTextsContext);
  const help = useMemo(() => bigMoneyHelp(wordingOf(office)), [office]);
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
      ? [<Column key="a" g={one} rows={one.rows.slice(0, half)} onPick={onPick} />, <Column key="b" g={one} rows={one.rows.slice(half)} onPick={onPick} cont />]
      : [<Column key="a" g={one} rows={one.rows} onPick={onPick} />];
  } else {
    cols = model.groups.map((g) => {
      const foldable = g.rows.length > BIG_MONEY_FOLD + 1;
      const fold = foldable && open[g.key] !== true;
      const more = foldable ? (
        <button type="button" class="link-btn bm-more" aria-expanded={!fold} onClick={() => setOpen((o) => ({ ...o, [g.key]: fold }))} data-bm-more={g.key}>
          {fold ? `ほか${String(g.rows.length - BIG_MONEY_FOLD)}件を見る ▾` : "閉じる ▴"}
        </button>
      ) : null;
      return <Column key={g.key} g={g} rows={fold ? g.rows.slice(0, BIG_MONEY_FOLD) : g.rows} onPick={onPick} more={more} />;
    });
  }
  const n = one !== null ? (split ? "s" : "1") : String(model.groups.length);
  return (
    <section class="card big-money" aria-label="これからの大きなお金" data-big-money>
      <div class="card-h">
        <h2>これからの大きなお金</h2>
        <Help label="これからの大きなお金" id="big-money">
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
