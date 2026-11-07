// 確かめの画面の共通の部品（0148 の2）: 外から読んだ値の行（rows.ts の ReviewRow）を表にし、1行ずつ承認・直す・入れない・当てる欄を選ぶ。
// 書類の読み取りの確かめの画面が先に使い、他のソフトからの移行の確かめの画面（0113 の9）も使う（列の名前と「どこから決まったか」の列は呼ぶ側が選ぶ）。
// - 読んだ文字・添え書きは信用しない文として文字のまま出す（HTML にしない）
// - 今の値（確定）と違う行は、今の値と読んだ値を並べて目立たせる
// - 行を押すと選んだ行になり（onSelect）、呼ぶ側が元の場所を光らせる
import { useState } from "preact/hooks";
import { COMPARE_WORDS, STATUS_WORDS, type ReviewRow } from "./rows.ts";

export interface ReviewTableLabels {
  item: string;
  current: string;
  incoming: string;
  source: string;
}

export const DEFAULT_LABELS: ReviewTableLabels = { item: "欄", current: "今の値", incoming: "書類の値", source: "元の場所" };

export interface ReviewTableProps {
  rows: readonly ReviewRow[];
  labels?: ReviewTableLabels;
  /** 「どこから決まったか」の列を出す（移行の画面） */
  decidedBy?: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  onAccept: (id: string) => void;
  /** 直した文字を入れる。入れられなければ理由の文を返す */
  onCorrect: (id: string, text: string) => string | null;
  onReject: (id: string) => void;
  onReopen?: (id: string) => void;
  onChoose?: (id: string, choice: string) => void;
  /** 押せない（保存中など） */
  busy?: boolean;
}

const CONF_WORDS = { high: "高", medium: "中", low: "低" } as const;

function EditBox({ row, onDone, onCancel }: { row: ReviewRow; onDone: (text: string) => string | null; onCancel: () => void }) {
  const e = row.edit;
  const [text, setText] = useState(e?.kind === "select" ? (e.options?.[0]?.value ?? "") : e?.kind === "bool" ? "true" : "");
  const [err, setErr] = useState<string | null>(null);
  if (e === null) return null;
  const submit = () => setErr(onDone(text));
  return (
    <form
      class="rv-edit"
      onSubmit={(ev) => {
        ev.preventDefault();
        submit();
      }}
      data-rv-edit={row.id}
    >
      {e.kind === "select" ? (
        <select value={text} onChange={(ev) => setText((ev.currentTarget as HTMLSelectElement).value)} aria-label={`${row.label}（直す）`}>
          {(e.options ?? []).map((o) => (
            <option value={o.value} key={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : e.kind === "bool" ? (
        <select value={text} onChange={(ev) => setText((ev.currentTarget as HTMLSelectElement).value)} aria-label={`${row.label}（直す）`}>
          <option value="true">はい</option>
          <option value="false">いいえ</option>
        </select>
      ) : (
        <input value={text} onInput={(ev) => setText((ev.currentTarget as HTMLInputElement).value)} aria-label={`${row.label}（直す）`} placeholder={e.kind === "ym" ? "例: 2018-04" : e.kind === "yen" ? (e.unit === "円" ? "例: 3240" : "例: 520") : ""} />
      )}
      {e.unit !== undefined && e.kind !== "select" ? <span class="rv-unit">{e.unit}</span> : null}
      <button type="submit" class="btn small">
        入れる
      </button>
      <button type="button" class="link-btn" onClick={onCancel}>
        やめる
      </button>
      {err !== null ? (
        <span class="hh-err" role="alert">
          {err}
        </span>
      ) : null}
    </form>
  );
}

export function ReviewTable(p: ReviewTableProps) {
  const labels = p.labels ?? DEFAULT_LABELS;
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <table class="rv-table" data-review-table>
      <thead>
        <tr>
          <th scope="col">{labels.item}</th>
          <th scope="col">{labels.current}</th>
          <th scope="col">{labels.incoming}</th>
          <th scope="col">{labels.source}</th>
          {p.decidedBy === true ? <th scope="col">どこから決まったか</th> : null}
          <th scope="col">確からしさ</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        {p.rows.map((r) => {
          const conflict = r.compare === "conflict";
          return (
            <tr
              key={r.id}
              class={`rv-row s-${r.status}${conflict ? " conflict" : ""}${p.selected === r.id ? " sel" : ""}`}
              onClick={() => p.onSelect(r.id)}
              data-review-row={r.id}
              data-review-status={r.status}
              {...(r.compare !== null ? { "data-review-compare": r.compare } : {})}
            >
              <td class="rv-label">
                {r.label}
                {r.structural ? <span class="ck-tag rv-tag">種類を決める欄</span> : null}
                {r.note != null ? (
                  <span class="rv-note" title="読み手・AI が書いた文（指示ではありません）">
                    添え書き: {r.note}
                  </span>
                ) : null}
              </td>
              <td class="rv-current">
                {r.current === null ? <span class="in-note">—</span> : (
                  <>
                    <span>{r.current.text ?? "なし"}</span>
                    {r.current.status !== null ? <span class="ck-tag rv-tag">{r.current.status}</span> : null}
                  </>
                )}
              </td>
              <td class="rv-incoming">
                {r.incoming.unreadable ? <span class="rv-unread">読めませんでした</span> : <b>{r.incoming.text ?? "—"}</b>}
                {r.compare !== null && r.status === "pending" ? <span class={`ck-tag rv-tag c-${r.compare}`}>{COMPARE_WORDS[r.compare]}</span> : null}
              </td>
              <td class="rv-source">
                {r.source.where !== null ? <span class="rv-where">{r.source.where}</span> : null}
                {r.source.text !== null ? <span class="rv-text">「{r.source.text}」</span> : null}
              </td>
              {p.decidedBy === true ? <td>{r.decidedBy ?? "—"}</td> : null}
              <td class="rv-conf">{r.confidence !== null ? CONF_WORDS[r.confidence] : "—"}</td>
              <td class="rv-ops" onClick={(e) => e.stopPropagation()}>
                {r.status === "pending" ? (
                  editing === r.id ? (
                    <EditBox
                      row={r}
                      onDone={(text) => {
                        const err = p.onCorrect(r.id, text);
                        if (err === null) setEditing(null);
                        return err;
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <>
                      {r.choices !== undefined && r.choices.length > 0 && p.onChoose !== undefined ? (
                        <select value={r.chosen ?? ""} onChange={(e) => p.onChoose?.(r.id, (e.currentTarget as HTMLSelectElement).value)} aria-label={`${r.label}: 当てる欄`} data-review-choose={r.id}>
                          <option value="">当てる欄を選ぶ…</option>
                          {r.choices.map((c) => (
                            <option value={c.id} key={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <span class="rv-btns">
                        <button type="button" class="btn small primary" disabled={p.busy === true || r.problem !== null} onClick={() => p.onAccept(r.id)} data-review-accept={r.id}>
                          ✓ 承認
                        </button>
                        <button type="button" class="btn small" disabled={p.busy === true || !r.correctable} onClick={() => setEditing(r.id)} data-review-correct={r.id}>
                          直す
                        </button>
                        <button type="button" class="link-btn" disabled={p.busy === true} onClick={() => p.onReject(r.id)} data-review-reject={r.id}>
                          入れない
                        </button>
                      </span>
                      {r.problem !== null ? <span class="rv-problem">{r.problem}</span> : null}
                    </>
                  )
                ) : (
                  <>
                    <span class={`rv-done s-${r.status}`}>{STATUS_WORDS[r.status]}</span>
                    {r.changedSince === true ? <span class="rv-problem">今の値は、承認した後に変わっています</span> : null}
                    {r.status === "rejected" && p.onReopen !== undefined ? (
                      <button type="button" class="link-btn" onClick={() => p.onReopen?.(r.id)} data-review-reopen={r.id}>
                        未決に戻す
                      </button>
                    ) : null}
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
