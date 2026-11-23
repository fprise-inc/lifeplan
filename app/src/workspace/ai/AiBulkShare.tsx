// 世帯をまとめて AI に渡す（0248）: 世帯の一覧の絞り込み（区分・番号）の結果から世帯を選び、1件ずつと同じ確かめ・期限・申告・記録で渡す。
// - 世帯の一覧の行の部品には触らず、一覧の上の操作として置く（選ぶ欄はこの中の一覧）
// - 渡せるかは本体の確かめ（bulkCheck。1件ずつと同じ ai_use）を見せるだけ。渡せない世帯は渡さず、理由ごとに件数と顧客番号を出す
// - 渡した後は、AI に見える仮名と顧客番号の対応を出す（AI の答えは仮名で並ぶ。顧客番号は AI に渡さない。0015 の5）
// - 保存していない変更のある開いている世帯は、保存した内容を渡す（0184 の追記と同じ）
// - 見本の世帯は一覧に入らず、本体も渡さない
import { useEffect, useState } from "preact/hooks";
import type { AiBulkOutcome, AiHost, AiStatus, StoredHousehold } from "../../engine/host.ts";
import { BULK_BLOCK_TEXT, BULK_LIMIT, BULK_MESSAGES, blockedCount, defaultSelection, numbersText, overLimit, sharedAmong } from "./bulk.ts";
import { NotesOptions } from "./AiNotesOptions.tsx";
import { aiMessage, aiUseAllowed, codeOf, durationText, maskWords } from "./model.ts";

export interface AiBulkShareProps {
  ai: AiHost;
  status: AiStatus | null;
  /** 世帯の一覧の絞り込みの結果（顧客の世帯だけ。見本は入らない） */
  households: readonly StoredHousehold[];
  /** 開いている保存した世帯 */
  currentId: string | null;
  /** 開いている世帯に、保存していない入力の変更があるか（あれば、保存した内容を渡すことを添える） */
  currentUnsaved: boolean;
  /** 渡した・取り消した後に、AI の状態を読み直す */
  onChanged: () => void;
  /** 初めから開いておく（テスト用） */
  initialOpen?: boolean;
  /** 初めの確かめ・結果（テスト用） */
  initialCheck?: AiBulkOutcome | null;
  initialDone?: AiBulkOutcome | null;
}

const bulkMessage = (code: string): string => BULK_MESSAGES[code] ?? aiMessage(code);

/** 確かめ・結果の一覧（渡せる・もう共有中・渡せない理由ごと） */
export function BulkOutcomeView({ o, done, notes = false }: { o: AiBulkOutcome; done: boolean; notes?: boolean }) {
  const blocked = blockedCount(o);
  // メモと面談の履歴（0249）: 渡した後は渡した世帯、確かめでは渡せない世帯（印を付けたときだけ出す）
  const notesShared = o.ready.filter((r) => r.notesShared === true);
  const notesNot = o.ready.filter((r) => r.notes !== undefined && !aiUseAllowed(r.notes) && (!done || r.notesShared !== true));
  return (
    <div class="ai-bulk-outcome" data-ai-bulk-outcome={done ? "done" : "check"}>
      {done ? (
        o.ready.length > 0 ? (
          <>
            <p data-ai-bulk-done={o.ready.length}>
              <b>{o.ready.length}件</b>をAIに渡しました。期限が来るか取り消すまで、接続した AI から読めます。
            </p>
            <p class="pl-sub">AI には顧客番号を渡していません。AI の答えに出る名前（仮名）と顧客番号の対応は次のとおりです。</p>
            <ul class="ai-bulk-aliases" data-ai-bulk-aliases>
              {o.ready.map((r) => (
                <li key={r.id}>
                  {r.customerNo} → {r.alias ?? "—"}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p data-ai-bulk-done="0">渡した世帯はありません。</p>
        )
      ) : (
        <p data-ai-bulk-ready={o.ready.length}>
          渡せる世帯: <b>{o.ready.length}件</b>
          {o.ready.length > 0 ? `（${numbersText(o.ready)}）` : ""}
        </p>
      )}
      {done && notesShared.length > 0 ? (
        <p data-ai-bulk-notes-shared={notesShared.length}>メモと面談の履歴も渡した世帯: {notesShared.length}件（{numbersText(notesShared)}）</p>
      ) : null}
      {notes && notesNot.length > 0 ? (
        <p class="in-note" data-ai-bulk-notes-not={notesNot.length}>
          メモと面談の履歴は渡{done ? "さなかった" : "せない"}世帯（同意が前の版・同意の記録が無いなど。計算に要る項目だけ渡します）: {notesNot.length}件（{numbersText(notesNot)}）
        </p>
      ) : null}
      {o.already.length > 0 ? (
        <p data-ai-bulk-already={o.already.length}>
          もう共有中の世帯: {o.already.length}件（{numbersText(o.already)}）。期限はそのままで、新しく渡しません。
        </p>
      ) : null}
      {blocked > 0 ? (
        <>
          <p data-ai-bulk-blocked={blocked}>
            {done ? "渡さなかった世帯" : "渡せない世帯"}: <b>{blocked}件</b>
          </p>
          <ul class="ai-limits">
            {o.blocked.map((g) => (
              <li key={g.reason} data-ai-bulk-reason={g.reason}>
                {BULK_BLOCK_TEXT[g.reason] ?? g.reason}（{g.households.length}件）: {numbersText(g.households)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function AiBulkShare(p: AiBulkShareProps) {
  const ids = p.households.map((h) => h.id);
  const key = ids.join(",");
  const [open, setOpen] = useState(p.initialOpen === true);
  const [selected, setSelected] = useState<string[]>(() => defaultSelection(ids));
  const [check, setCheck] = useState<AiBulkOutcome | null>(p.initialCheck ?? null);
  const [done, setDone] = useState<AiBulkOutcome | null>(p.initialDone ?? null);
  const [destination, setDestination] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);
  // メモと面談の履歴も渡す（0249）。事務所の設定で最初から付けておける。伏せる言葉は保存しない
  const [notesOn, setNotesOn] = useState(p.status?.notesByDefault === true);
  const [words, setWords] = useState("");

  // 絞り込みが変わったら、選び直す（一覧に無い世帯は選ばない）
  useEffect(() => {
    setSelected(defaultSelection(ids));
    setDone(null);
  }, [key]);

  const chosen = selected.filter((id) => ids.includes(id));
  const chosenKey = chosen.join(",");
  // 選んだ世帯を本体で確かめる（共有は作らない）。上限を超える選び方は確かめない
  useEffect(() => {
    if (!open || p.ai.bulkCheck === undefined) return;
    if (chosen.length === 0 || chosen.length > BULK_LIMIT) {
      setCheck(null);
      return;
    }
    let alive = true;
    p.ai.bulkCheck(chosen).then(
      (o) => alive && setCheck(o),
      (e: unknown) => alive && setError(bulkMessage(codeOf(e))),
    );
    return () => {
      alive = false;
    };
  }, [open, chosenKey, p.status?.shares.length]);

  if (p.status?.enabled !== true || p.ai.bulkStart === undefined || p.households.length === 0) return null;
  const shared = sharedAmong(p.status.shares, ids);
  const over = overLimit(chosen.length, check);
  const ready = check?.ready.length ?? 0;
  const current = p.households.find((h) => h.id === p.currentId);
  const unsavedNote = p.currentUnsaved && current !== undefined && chosen.includes(current.id);

  const stopAll = () => {
    const stop = p.ai.bulkStop;
    if (stop === undefined) return;
    setBusy(true);
    setError(null);
    stop(shared).then(
      (n) => {
        setBusy(false);
        setStopped(`${n}件の共有を取り消しました`);
        setDone(null);
        p.onChanged();
      },
      (e: unknown) => {
        setBusy(false);
        setError(bulkMessage(codeOf(e)));
      },
    );
  };

  const head = (
    <div class="ai-bulk-head" data-ai-bulk>
      {!open ? (
        <button type="button" class="btn small" onClick={() => setOpen(true)} data-ai-bulk-open>
          選んだ世帯をまとめてAIに渡す
        </button>
      ) : null}
      {shared.length > 0 ? (
        <>
          <span class="pl-sub" data-ai-bulk-shared={shared.length}>
            この一覧で AI に渡している世帯: {shared.length}件
          </span>
          <button type="button" class="link-btn danger" disabled={busy} onClick={stopAll} data-ai-bulk-stop>
            この一覧の共有をまとめて取り消す
          </button>
        </>
      ) : null}
      {stopped !== null ? (
        <span class="pl-sub" role="status">
          {stopped}
        </span>
      ) : null}
    </div>
  );
  if (!open) return head;

  const toggle = (id: string, on: boolean) => {
    setSelected(on ? [...chosen, id] : chosen.filter((x) => x !== id));
    setDone(null);
  };

  return (
    <>
      {head}
      <div class="ai-bulk" data-ai-bulk-panel>
        <h4 class="hh-h">選んだ世帯をまとめてAIに渡す</h4>
        <p class="pl-sub">
          一覧に出ている世帯（{p.households.length}件。区分と番号で絞り込めます）から選びます。1回に渡せるのは、共有中の世帯と合わせて{check?.limit ?? BULK_LIMIT}件までです。
        </p>
        <div class="ai-bulk-pick" role="group" aria-label="渡す世帯">
          <button type="button" class="link-btn" onClick={() => setSelected(ids.slice(0, BULK_LIMIT))} data-ai-bulk-all>
            すべて選ぶ
          </button>
          <button type="button" class="link-btn" onClick={() => setSelected([])} data-ai-bulk-none>
            すべて外す
          </button>
          <span class="pl-sub" data-ai-bulk-count={chosen.length}>
            {chosen.length}件を選んでいます
          </span>
          <ul class="ai-bulk-list">
            {p.households.map((h) => (
              <li key={h.id}>
                <label>
                  <input type="checkbox" checked={chosen.includes(h.id)} onChange={(e) => toggle(h.id, (e.currentTarget as HTMLInputElement).checked)} data-ai-bulk-pick={h.customerNo} />
                  {h.customerNo}
                  {h.id === p.currentId ? "（開いています）" : ""}
                </label>
              </li>
            ))}
          </ul>
        </div>
        {over !== null ? (
          <p class="in-note" data-ai-bulk-over>
            {over}
          </p>
        ) : null}
        {done !== null ? <BulkOutcomeView o={done} done notes={notesOn} /> : check !== null ? <BulkOutcomeView o={check} done={false} notes={notesOn} /> : null}
        {p.ai.notesPreview !== undefined ? (
          <NotesOptions
            ai={p.ai}
            ids={(check?.ready ?? []).filter((r) => r.notes !== undefined && aiUseAllowed(r.notes)).map((r) => r.id)}
            on={notesOn}
            onToggle={setNotesOn}
            words={words}
            onWords={setWords}
            blocked={null}
            bulk
          />
        ) : null}
        {unsavedNote ? (
          <p class="in-note" data-ai-bulk-unsaved>
            開いている世帯（{current.customerNo}）は、保存した内容を渡します。いまの入力の変更は、保存するまでAIの計算に入りません。
          </p>
        ) : null}
        <form
          class="ai-form"
          onSubmit={(e) => {
            e.preventDefault();
            const start = p.ai.bulkStart;
            if (start === undefined) return;
            setBusy(true);
            setError(null);
            const notes = notesOn && p.ai.notesPreview !== undefined ? { ids: chosen, words: maskWords(words) } : undefined;
            (notes !== undefined ? start(chosen, minutes, destination, notes) : start(chosen, minutes, destination)).then(
              (o) => {
                setBusy(false);
                setDone(o);
                setCheck(null);
                p.onChanged();
              },
              (err: unknown) => {
                setBusy(false);
                setError(bulkMessage(codeOf(err)));
              },
            );
          }}
          data-ai-bulk-form
        >
          <div class="ai-grid">
            <label>
              使うAIのアプリ（申告）
              <input value={destination} maxLength={60} placeholder="例: 事務所のAIアプリ" onInput={(e) => setDestination((e.currentTarget as HTMLInputElement).value)} data-ai-bulk-destination />
            </label>
            <label>
              期限
              <select value={String(minutes)} onChange={(e) => setMinutes(Number((e.currentTarget as HTMLSelectElement).value))} data-ai-bulk-minutes>
                {(p.status.durations.length > 0 ? p.status.durations : [60]).map((m) => (
                  <option key={m} value={String(m)}>
                    {durationText(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul class="ai-limits">
            <li>1件ずつ渡すときと同じく、渡すのは計算に要る項目だけ（縮約版）です。メモと面談の履歴は、上の印を付けたときだけ、渡せる世帯の分を渡します。</li>
            <li>同意が無い・お客さまが断った・撤回した世帯と見本の世帯は渡しません。</li>
            <li>許可は「このPCの AI との接続全体」に出すものです。申告したアプリの名前は確かめられません（記録には申告として残ります）。</li>
            <li>取り消しで止まるのは今後の読み取りだけです。すでに送った内容は、AIの会社の側に残ります。</li>
          </ul>
          <div class="ai-actions">
            <button type="submit" class="btn primary" disabled={busy || destination.trim() === "" || chosen.length === 0 || over !== null || (check !== null && ready === 0)} data-ai-bulk-start>
              選んだ世帯をAIに渡す{check !== null ? `（${ready}件）` : ""}
            </button>
            <button type="button" class="btn" onClick={() => setOpen(false)} data-ai-bulk-close>
              閉じる
            </button>
          </div>
          {error !== null ? (
            <p class="hh-err" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </>
  );
}
