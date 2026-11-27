// 写真・スクショ・画像だけの PDF から読んだ明細を、画像の横で確かめて直す（0034 の段階3。0221）。
// - 左に画像（PDF はページを描いた絵）、右に読んだ表（日付・店・金額）。行を直す・消す・足す。「読み取りが不確か」の行には印を出し、
//   画像と照らし合わせて「確かめた」を押すか直すと印が外れる。直した行は取り込むときに今の取り込みの流れにもう一度通す（番号はそこでもう一度消える）
//   印の理由が分かるもの（銀行の明細の残高と合わない・明細の合計と合わない）は、印の下に短く出す
// - 明細に合計が書かれていれば、読んだ行の和と照らし合わせる（何枚かのスクショは重なりを2回足さない）。読んだときに合わなければ、
//   読んだ全部の行に「読み取りが不確か」の印が付いている（markTotalMismatch）
// - 画像は描くときだけパネルの中で持ち、どこにも保存しない
import { useEffect, useRef, useState } from "preact/hooks";
import type { SourceKind } from "../../../../statement/src/index.ts";
import { editRowProblem, editTotalCheck, newEditRow, yen, type EditRow, type ReadOk } from "./model.ts";
import { rasterizePdf } from "./rasterize.ts";

export interface ImageItem {
  readonly bytes: Uint8Array;
  readonly out: ReadOk;
  readonly rows: readonly EditRow[];
  /** 読んだときに明細の合計と合わず、全部の行に「読み取りが不確か」の印を付けた */
  readonly totalMarked?: boolean;
}

/** 画像（PNG・JPEG・HEIC）か、画像だけの PDF のページを、キャンバスに描く */
function ImageView({ bytes, pdf }: { bytes: Uint8Array; pdf: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const el = box.current;
    if (el === null) return;
    el.replaceChildren();
    setFailed(false);
    void (async () => {
      try {
        const images = pdf ? (await rasterizePdf(bytes, 30)).pages : [bytes];
        for (const img of images) {
          const bmp = await createImageBitmap(new Blob([img as Uint8Array<ArrayBuffer>]));
          if (!live) return bmp.close();
          const c = document.createElement("canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          c.getContext("2d")?.drawImage(bmp, 0, 0);
          bmp.close();
          c.className = "st-img-page";
          el.append(c);
        }
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      el.replaceChildren();
    };
  }, [bytes, pdf]);
  return (
    <div class="st-img-view" data-statement-image>
      <div ref={box} />
      {failed ? <p class="rp-note">この画像はここに表示できません（読んだ表は右にあります）。</p> : null}
    </div>
  );
}

export function ImageCheck({ items, index, kind, busy, onIndex, onRows }: { items: readonly ImageItem[]; index: number; kind: SourceKind; busy: boolean; onIndex: (i: number) => void; onRows: (i: number, rows: EditRow[]) => void }) {
  const it = items[index] as ImageItem;
  const rows = it.rows;
  const set = (k: string, patch: Partial<EditRow>) => onRows(index, rows.map((r) => (r.key === k ? { ...r, ...patch, ...("uncertain" in patch ? {} : { uncertain: false }) } : r)));
  const total = editTotalCheck(items, kind);
  const unsure = rows.filter((r) => r.uncertain).length;
  const ocr = it.out.ocr;
  const strictWin = ocr !== undefined && ocr.engine.startsWith("windows") && ocr.source !== "screenshot";
  const lastDate = rows[rows.length - 1]?.date ?? "";
  return (
    <div class="st-img" data-statement-image-check>
      {items.length > 1 ? (
        <div class="st-img-pager" role="tablist" aria-label="読んだ画像">
          {items.map((x, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === index} class={i === index ? "on" : ""} onClick={() => onIndex(i)} data-statement-image-tab={i}>
              {i + 1}枚目<small>{x.rows.length}行</small>
            </button>
          ))}
        </div>
      ) : null}
      <p class="rp-note">
        画像と照らし合わせて、日付・店・金額を確認してください。違うところは直し、明細でない行は消し、読めていない行は足します。
        {unsure > 0 ? `「読み取りが不確か」の印の行（${unsure}行）は、特によく照らし合わせてください。` : ""}
      </p>
      {strictWin ? <p class="rp-note warn">Windows で写真・スキャンを読むと、数字を読み違えやすいため、「読み取りが不確か」の印を多めに付けています。</p> : null}
      {total !== null ? (
        <p class={`rp-note${total.ok ? "" : " warn"}`} data-statement-total={total.ok ? "ok" : "ng"}>
          {total.ok
            ? `明細の合計（${yen(total.sum)}）と、読んだ行の和が合っています。`
            : `明細の合計（${total.totals.map(yen).join("・")}）と、読んだ行の和（${yen(total.sum)}）が合いません。読めていない行か、読み違えた金額があります。${items.some((x) => x.totalMarked === true) ? "読んだ全部の行に「読み取りが不確か」の印を付けました。" : ""}`}
        </p>
      ) : null}
      <div class="st-img-cols">
        <ImageView bytes={it.bytes} pdf={it.out.reader.id === "pdfScan"} />
        <div class="st-img-table">
          <table class="st-edit-t">
            <thead>
              <tr>
                <th>日付</th>
                <th>店・内容</th>
                <th class="num">金額（円）</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = editRowProblem(r);
                return (
                  <tr key={r.key} class={r.uncertain ? "unsure" : ""} data-statement-edit-row={r.uncertain ? "unsure" : "ok"}>
                    <td>
                      <input type="text" inputMode="numeric" value={r.date} disabled={busy} aria-label="日付" onInput={(e) => set(r.key, { date: (e.currentTarget as HTMLInputElement).value })} size={10} />
                    </td>
                    <td>
                      <input type="text" value={r.merchant} disabled={busy} aria-label="店・内容" onInput={(e) => set(r.key, { merchant: (e.currentTarget as HTMLInputElement).value })} />
                      {r.uncertain ? (
                        <span class="st-unsure">
                          読み取りが不確か
                          <button type="button" class="btn small" disabled={busy} onClick={() => set(r.key, { uncertain: false })} data-statement-edit-ok>
                            確認した
                          </button>
                          {r.why !== undefined ? (
                            <small class="st-unsure-why" data-statement-edit-why>
                              {r.why}
                            </small>
                          ) : null}
                        </span>
                      ) : null}
                      {p !== null ? <small class="fatal">{p}</small> : null}
                    </td>
                    <td class="num">
                      <input type="text" inputMode="numeric" value={r.amount} disabled={busy} aria-label="金額" onInput={(e) => set(r.key, { amount: (e.currentTarget as HTMLInputElement).value })} size={9} />
                    </td>
                    <td>
                      <button type="button" class="btn small" disabled={busy} aria-label="この行を消す" onClick={() => onRows(index, rows.filter((x) => x.key !== r.key))} data-statement-edit-remove>
                        消す
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div class="rp-actions">
            <button type="button" class="btn small" disabled={busy} onClick={() => onRows(index, [...rows, newEditRow(rows, lastDate)])} data-statement-edit-add>
              行を足す
            </button>
          </div>
          <p class="rp-note">店の名前にカード番号などの番号を書いても、取り込むときに消えます（●●●●）。画像は保存しません。</p>
        </div>
      </div>
    </div>
  );
}

/** 撮り方の案内（写真・スクショを選ぶ前と、読んだ後に出す） */
export function ShootingTips({ compact = false }: { compact?: boolean }) {
  return (
    <div class="st-tips" data-statement-tips>
      <b>写真・スクショの撮り方</b>
      <ul>
        <li>明るい所で、真上から、文字が大きく写るように撮ってください（影・斜め・ぼけは読み違いのもとです）。</li>
        <li>スマホ・パソコンの画面は、写真よりスクショの方が確かに読めます。字が小さいときは、画面を拡大してから撮ってください。</li>
        {compact ? null : <li>長い明細は、何枚かに分けて撮って、まとめて選べます（重なった行は2回数えません）。</li>}
      </ul>
    </div>
  );
}
