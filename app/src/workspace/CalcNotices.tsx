// 計算の知らせ（結果のタブ。0064）: 計算エンジンの知らせを、種類ごとにまとめて出す。閉じているときは1行（種類ごとの数）。
// 入力で直せる知らせは「入力で開く」でそのカードを開く（開くだけ。値は変えない）
// 事務所の文（カスタム層の説明の文の差し替え。0016 の追記）を当てた行は、小さく「事務所の文」と出し、公式の文を開ける。
// 事務所の設定で隠した知らせ（前提の外・仮の値・制度データの知らせだけ）は、一覧の最後の「事務所の設定で隠している知らせ（○件）」から開ける
import { useState } from "preact/hooks";
import type { StageId } from "./input/form.ts";
import { NOTICE_KINDS, noticeCounts, noticeMeta, type NoticeRow } from "./engineNotices.ts";
import { officeLabel } from "./office/customTexts.ts";

function Row({ r, onOpenCard }: { r: NoticeRow; onOpenCard?: ((card: StageId) => void) | undefined }) {
  const meta = noticeMeta(r);
  return (
    <li data-cn-row={r.key}>
      <span class="cn-text">{r.text}</span>
      {r.card !== null && onOpenCard !== undefined ? (
        <button type="button" class="link-btn" onClick={() => onOpenCard(r.card as StageId)} data-cn-open={r.card}>
          入力で開く
        </button>
      ) : null}
      {meta.length > 0 ? <span class="cn-meta">{meta.join("／")}</span> : null}
      {r.office !== undefined && r.official !== undefined && r.hidden !== true ? (
        <details class="cn-office" data-cn-office={r.office.id}>
          <summary>{officeLabel(r.office)}・公式の文を見る</summary>
          <span>{r.official}</span>
        </details>
      ) : null}
    </li>
  );
}

export function CalcNotices({ rows, onOpenCard, initialOpen = false }: { rows: readonly NoticeRow[]; onOpenCard?: (card: StageId) => void; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  if (rows.length === 0) return null;
  const hidden = rows.filter((r) => r.hidden === true);
  const shown = rows.filter((r) => r.hidden !== true);
  const counts = noticeCounts(shown);
  const urgent = counts.input + counts.missing;
  return (
    <div class={`calc-notices${urgent > 0 ? " urgent" : ""}`} data-calc-notices={rows.length}>
      <div class="cn-bar">
        <span class="fee-tag">計算のお知らせ</span>
        <span class="cn-counts">
          {NOTICE_KINDS.filter((k) => counts[k.id] > 0)
            .map((k) => `${k.short} ${counts[k.id]}`)
            .join("・")}
          {hidden.length > 0 ? `${shown.length > 0 ? "・" : ""}事務所の設定で隠している ${hidden.length}` : ""}
        </span>
        <button type="button" class="link-btn" aria-expanded={open} onClick={() => setOpen(!open)} data-calc-notices-open>
          {open ? "閉じる" : "見る"}
        </button>
      </div>
      {open ? (
        <div class="cn-body">
          {NOTICE_KINDS.map((k) => {
            const list = shown.filter((r) => r.kind === k.id);
            if (list.length === 0) return null;
            return (
              <div class={`cn-kind cn-${k.id}`} key={k.id} data-cn-kind={k.id}>
                <h3>
                  {k.label}（{list.length}）
                </h3>
                <ul>
                  {list.map((r) => (
                    <Row key={r.key} r={r} onOpenCard={onOpenCard} />
                  ))}
                </ul>
              </div>
            );
          })}
          {hidden.length > 0 ? (
            <details class="cn-hidden" data-cn-hidden={hidden.length}>
              <summary>事務所の設定で隠している知らせ（{hidden.length}件）</summary>
              <ul>
                {hidden.map((r) => (
                  <Row key={r.key} r={r} onOpenCard={onOpenCard} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
