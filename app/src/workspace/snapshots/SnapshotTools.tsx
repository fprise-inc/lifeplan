// 控えの道具（入力のホームの上部。控えめに置く）: 「この時点を残す」（面談の区切りに FP が押す）と、控えの一覧（日時・きっかけ・メモ）。
// 提案書の PDF を保存したときの控えは、提案書のタブが自動で作る（ReportTab.tsx）。控えは作った後に変えない（消すことはできる）
import { useEffect, useState } from "preact/hooks";
import { SNAPSHOT_MEMO_MAX, snapshotDateText, TRIGGER_TEXT, verifySnapshot, type Snapshot } from "./snapshots.ts";

export interface SnapshotToolsProps {
  list: readonly Snapshot[];
  /** 保存している世帯か（見本・保存していない世帯の控えは、アプリを閉じると消える） */
  stored: boolean;
  /** 控えを作る（メモつき） */
  onTake: (memo: string) => Promise<void>;
  onRemove: (id: string) => void;
  /** 開いた状態で出す（画面の確かめ用） */
  initialOpen?: boolean;
}

export function SnapshotTools({ list, stored, onTake, onRemove, initialOpen }: SnapshotToolsProps) {
  const [mode, setMode] = useState<null | "take" | "list">(initialOpen === true ? "list" : null);
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  /** 指紋の確かめ（控えの ID → 作ったときのままか） */
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (mode !== "list") return;
    let alive = true;
    void Promise.all(list.map(async (s) => [s.id, await verifySnapshot(s).catch(() => false)] as const)).then((r) => {
      if (alive) setChecked(Object.fromEntries(r));
    });
    return () => {
      alive = false;
    };
  }, [mode, list]);
  useEffect(() => {
    if (msg === null) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);

  const take = async () => {
    setBusy(true);
    try {
      await onTake(memo);
      setMemo("");
      setMode(null);
      setMsg(stored ? "この時点を控えとして残しました" : "この時点を控えとして残しました（保存していない世帯なので、アプリを閉じると消えます）");
    } finally {
      setBusy(false);
    }
  };
  // 新しい順（同じ秒に作ったものは、後に足したものを先に）
  const sorted = [...list].reverse().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  return (
    <>
      <div class="hs-tools snap-tools" role="group" aria-label="控え">
        <span class="hs-tools-h">控え</span>
        <button type="button" class="link-btn" onClick={() => setMode(mode === "take" ? null : "take")} aria-expanded={mode === "take"} data-snapshot-take>
          この時点を残す
        </button>
        <button type="button" class="link-btn" onClick={() => setMode(mode === "list" ? null : "list")} aria-expanded={mode === "list"} data-snapshot-list>
          控えの一覧（{list.length}件）
        </button>
      </div>
      {msg !== null ? (
        <p class="hs-msg" role="status" data-snapshot-msg>
          {msg}
        </p>
      ) : null}
      {mode === "take" ? (
        <section class="card hs-panel snap-panel" aria-label="この時点を残す" data-snapshot-form>
          <div class="card-h">
            <h2>この時点を残す</h2>
            <span class="aside">今の現状とプラン（保存していない変更を含む）を、変えられない控えとして残します</span>
          </div>
          <form
            class="snap-form"
            onSubmit={(e) => {
              e.preventDefault();
              void take();
            }}
          >
            <label>
              <span>メモ（任意）</span>
              <input type="text" value={memo} maxLength={SNAPSHOT_MEMO_MAX} placeholder="例: 1回目の面談の後" onInput={(e) => setMemo((e.currentTarget as HTMLInputElement).value)} data-snapshot-memo />
            </label>
            <div class="rp-actions">
              <button type="submit" class="btn primary" disabled={busy} data-snapshot-go>
                残す
              </button>
              <button type="button" class="btn" onClick={() => setMode(null)}>
                キャンセル
              </button>
            </div>
          </form>
          <p class="rp-note">提案書の PDF を保存したときは、自動で控えを残します。メモに顧客の氏名は書かないでください。</p>
        </section>
      ) : null}
      {mode === "list" ? (
        <section class="card hs-panel snap-panel" aria-label="控えの一覧" data-snapshot-panel>
          <div class="card-h">
            <h2>控えの一覧</h2>
            <span class="aside">{stored ? "世帯ファイルに保存しています" : "保存していない世帯です。アプリを閉じると消えます"}</span>
          </div>
          {sorted.length === 0 ? (
            <p class="rp-note">まだ控えはありません。「この時点を残す」か、提案書の PDF を保存すると残ります。</p>
          ) : (
            <table class="snap-table">
              <thead>
                <tr>
                  <th scope="col">日時</th>
                  <th scope="col">きっかけ</th>
                  <th scope="col">メモ</th>
                  <th scope="col">プラン</th>
                  <th scope="col" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.id} data-snapshot-row={s.trigger}>
                    <td class="snap-date">{snapshotDateText(s.createdAt)}</td>
                    <td>
                      <span class={`snap-kind ${s.trigger}`}>{TRIGGER_TEXT[s.trigger]}</span>
                    </td>
                    <td>
                      {s.memo !== "" ? s.memo : <span class="snap-none">—</span>}
                      {checked[s.id] === false ? (
                        <span class="snap-bad" role="note" data-snapshot-changed>
                          控えが変更されています
                        </span>
                      ) : null}
                    </td>
                    <td>{s.plan !== null ? `プラン${s.plan.letter}${s.plan.name !== "" && s.plan.name !== "現状" ? ` ${s.plan.name}` : ""}` : "—"}</td>
                    <td class="snap-ops">
                      {removing === s.id ? (
                        <>
                          <button
                            type="button"
                            class="link-btn danger"
                            onClick={() => {
                              onRemove(s.id);
                              setRemoving(null);
                            }}
                            data-snapshot-remove-go
                          >
                            外す
                          </button>
                          <button type="button" class="link-btn" onClick={() => setRemoving(null)}>
                            キャンセル
                          </button>
                        </>
                      ) : (
                        <button type="button" class="link-btn" onClick={() => setRemoving(s.id)} data-snapshot-remove>
                          外す
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div class="rp-actions">
            <button type="button" class="btn" onClick={() => setMode(null)}>
              閉じる
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
