// 面談の履歴の画面（0182。作業の層の部品）: 入口は上の帯の FP のメニューの「面談の履歴（N件）」。開いた中身は入力のホームの上部に出す。
// - 一覧（新しい順）・1件を開く（その日の控えの数字と、今の見込み・入力の違いを並べる。0074）・足す／直す・外す
// - 「FP だけの欄を隠す」を入れると、お客さまと一緒に見るときに FP だけの欄（FP のメモ・FP だけにした保険の意向）を画面から外す
// - 提示層の部品には渡さない（0016 の2）。持ち帰り・提案書・AI にも出さない（お客さまと見てよい欄も、今は画面で一緒に見るだけ）
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { snapshotDateText, TRIGGER_TEXT, type Snapshot } from "../snapshots/snapshots.ts";
import { SnapshotCompare } from "../tools/FpTools.tsx";
import { EMPTY_INTENT, hasContent, intentOf, isMeetingDate, MEETING_TEXT_MAX, meetingDateText, newMeeting, putMeeting, sortedMeetings, todayText, withIntent, withoutMeeting, type InsuranceIntent, type Meeting } from "./meetings.ts";

export interface MeetingToolsProps {
  wh: WorkingHousehold;
  /** 面談の履歴を入れる（元に戻す・やり直すの履歴に積む） */
  onSave: (list: Meeting[]) => void;
  /** この時点を残す（新しい控えを作り、その ID を返す。作れなければ null） */
  onSnapshot?: ((memo: string) => Promise<string | null>) | undefined;
  onClose: () => void;
  /** 現状の計算結果（控えと並べる今の見込み） */
  result: PreviewResult | null;
  computeOne?: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined;
  onOpen: (card: string) => void;
  atAge?: number;
  /** 事務所で共有しているときの自分（メンバーの内部ID） */
  me?: string | null;
  /** メンバーの内部ID → 表示名 */
  names?: Record<string, string>;
  /** 保存している世帯か（保存していない世帯の記録は、アプリを閉じると消える） */
  stored?: boolean;
  /** この記録を開く（前回から変わったことから。n は押した回数） */
  focus?: { id: string; n: number } | null;
  /** FP だけの欄を隠して開く（画面の確かめ用） */
  initialHideFp?: boolean;
}

type View = { kind: "list" } | { kind: "open"; id: string } | { kind: "edit"; draft: Meeting; isNew: boolean; snap: SnapChoice };
/** 控えのつなぎ方: 新しく残す・つながない・今ある控え（ID） */
type SnapChoice = { kind: "take" } | { kind: "none" } | { kind: "pick"; id: string };

const newestSnaps = (list: readonly Snapshot[]) => [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
const firstLine = (t: string) => t.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";

export function MeetingTools({ wh, onSave, onSnapshot, onClose, result, computeOne, onOpen, atAge = 90, me = null, names = {}, stored = true, focus = null, initialHideFp = false }: MeetingToolsProps) {
  const list = useMemo(() => wh.meetings ?? [], [wh.meetings]);
  const sorted = useMemo(() => sortedMeetings(list), [list]);
  const snaps = useMemo(() => newestSnaps(wh.snapshots ?? []), [wh.snapshots]);
  const [view, setView] = useState<View>(focus !== null && list.some((m) => m.id === focus.id) ? { kind: "open", id: focus.id } : { kind: "list" });
  const [hideFp, setHideFp] = useState(initialHideFp);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (focus !== null && list.some((m) => m.id === focus.id)) setView({ kind: "open", id: focus.id });
  }, [focus?.n]);
  useEffect(() => {
    if (msg === null) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  const nameOf = (id: string | undefined) => (id === undefined ? null : (names[id] ?? "メンバー"));
  const snapOf = (id: string | undefined) => (id === undefined ? null : (snaps.find((s) => s.id === id) ?? null));

  const startNew = () => setView({ kind: "edit", draft: newMeeting(todayText()), isNew: true, snap: onSnapshot !== undefined ? { kind: "take" } : { kind: "none" } });
  const startEdit = (m: Meeting) => setView({ kind: "edit", draft: structuredClone(m), isNew: false, snap: m.snapshot !== undefined ? { kind: "pick", id: m.snapshot } : { kind: "none" } });

  const save = async (v: Extract<View, { kind: "edit" }>) => {
    if (!isMeetingDate(v.draft.on)) return setMsg("面談の日を入れてください");
    // 書いた欄も控えも無い記録は足さない（控えを作る前に確かめる）
    if (!hasContent({ ...v.draft, ...(v.snap.kind !== "none" ? { snapshot: "-" } : {}) })) return setMsg("書いた欄がありません。話したこと・決めたことなどを入れてください");
    setBusy(true);
    try {
      let snapshot: string | undefined;
      if (v.snap.kind === "pick") snapshot = v.snap.id;
      else if (v.snap.kind === "take" && onSnapshot !== undefined) snapshot = (await onSnapshot(`面談の記録（${meetingDateText(v.draft.on)}）`)) ?? undefined;
      const { snapshot: _old, ...rest } = v.draft;
      void _old;
      const m: Meeting = { ...rest, ...(snapshot !== undefined ? { snapshot } : {}) };
      onSave(putMeeting(list, m, me));
      setMsg(v.isNew ? (stored ? "面談の記録を足しました" : "面談の記録を足しました（保存していない世帯なので、アプリを閉じると消えます）") : "面談の記録を直しました");
      setView({ kind: "open", id: m.id });
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <div class="card-h">
      <h2>面談の履歴</h2>
      <span class="aside">面談ごとの記録です。「FP だけ」の欄は、お客さまに見せる画面・持ち帰り用のレポート・提案書・AI には出しません</span>
      <label class="mt-hide">
        <input type="checkbox" checked={hideFp} onChange={(e) => setHideFp((e.currentTarget as HTMLInputElement).checked)} data-meeting-hide-fp />
        FP だけの欄を隠す（お客さまと一緒に見るとき）
      </label>
      <button type="button" class="btn" onClick={onClose}>
        閉じる
      </button>
    </div>
  );

  return (
    <section class="card fp-panel mt-panel" aria-label="面談の履歴" data-meetings>
      {head}
      {msg !== null ? (
        <p class="hs-msg" role="status" data-meeting-msg>
          {msg}
        </p>
      ) : null}
      {view.kind === "list" ? (
        <>
          <div class="rp-actions">
            <button type="button" class="btn primary" onClick={startNew} data-meeting-new>
              ＋ 面談の記録を足す
            </button>
          </div>
          {sorted.length === 0 ? (
            <p class="in-note">まだ面談の記録はありません。面談のあとに「＋ 面談の記録を足す」で、話したこと・決めたこと・次までにやることを残します。</p>
          ) : (
            <ul class="fp-list mt-list" data-meeting-list>
              {sorted.map((m) => (
                <li key={m.id} data-meeting-row={m.id}>
                  <span class="fp-when">{meetingDateText(m.on)}</span>
                  <span class="mt-gist">{firstLine(m.shared.decided) || firstLine(m.shared.talked) || (hideFp ? "" : firstLine(m.fpOnly.note)) || "—"}</span>
                  {m.snapshot !== undefined ? <span class="fp-v">{snapOf(m.snapshot) !== null ? "控えあり" : "控えは外されています"}</span> : null}
                  {nameOf(m.by) !== null ? <span class="fp-v">書いた人 {nameOf(m.by)}</span> : null}
                  <button type="button" class="link-btn" onClick={() => setView({ kind: "open", id: m.id })} data-meeting-open={m.id}>
                    開く
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      {view.kind === "open"
        ? ((m) =>
            m === undefined ? null : (
              <div class="mt-open" data-meeting-view={m.id}>
                <div class="mt-record">
                  <h3>{meetingDateText(m.on)}の面談</h3>
                  {nameOf(m.by) !== null ? (
                    <p class="fp-v" data-meeting-authors>
                      書いた人 {nameOf(m.by)}
                      {nameOf(m.editedBy) !== null ? `・最後に直した人 ${nameOf(m.editedBy)}` : ""}
                    </p>
                  ) : null}
                  <div class="mt-group" data-meeting-shared>
                    <p class="mt-group-h">お客さまと一緒に見てよい欄</p>
                    <Read label="話したこと" text={m.shared.talked} />
                    <Read label="決めたこと" text={m.shared.decided} />
                    <Read label="次までにやること" text={m.shared.todo} />
                    {m.shared.insurance !== undefined ? <IntentRead intent={m.shared.insurance} /> : null}
                  </div>
                  {!hideFp ? (
                    <div class="mt-group mt-fp" data-meeting-fp>
                      <p class="mt-group-h">FP だけ（お客さまには見せない）</p>
                      <Read label="FP のメモ" text={m.fpOnly.note} />
                      {m.fpOnly.insurance !== undefined ? <IntentRead intent={m.fpOnly.insurance} /> : null}
                    </div>
                  ) : null}
                  <div class="rp-actions">
                    <button type="button" class="btn" onClick={() => startEdit(m)} data-meeting-edit>
                      直す
                    </button>
                    {removing ? (
                      <>
                        <button
                          type="button"
                          class="btn danger"
                          onClick={() => {
                            onSave(withoutMeeting(list, m.id));
                            setRemoving(false);
                            setMsg("面談の記録を外しました（元に戻すで戻せます）");
                            setView({ kind: "list" });
                          }}
                          data-meeting-remove-go
                        >
                          外す
                        </button>
                        <button type="button" class="btn" onClick={() => setRemoving(false)}>
                          キャンセル
                        </button>
                      </>
                    ) : (
                      <button type="button" class="btn" onClick={() => setRemoving(true)} data-meeting-remove>
                        外す
                      </button>
                    )}
                    <button type="button" class="btn" onClick={() => setView({ kind: "list" })} data-meeting-back>
                      一覧へ戻る
                    </button>
                  </div>
                </div>
                <div class="mt-snap" data-meeting-snapshot>
                  <h3>そのときの控えと今</h3>
                  {((s) =>
                    m.snapshot === undefined ? (
                      <p class="in-note">控えをつないでいません。「直す」で、その日の控えを選べます。</p>
                    ) : s === null ? (
                      <p class="in-note">つないだ控えは外されています。</p>
                    ) : (
                      <>
                        <p class="mt-snap-when">
                          {snapshotDateText(s.createdAt)}（{TRIGGER_TEXT[s.trigger]}
                          {s.memo !== "" ? `・${s.memo}` : ""}）
                        </p>
                        <SnapshotCompare wh={wh} snap={s} result={result} computeOne={computeOne} onOpen={onOpen} atAge={atAge} />
                      </>
                    ))(snapOf(m.snapshot))}
                </div>
              </div>
            ))(list.find((x) => x.id === view.id))
        : null}
      {view.kind === "edit" ? (
        <form
          class="mt-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(view);
          }}
          data-meeting-form
        >
          <label class="mt-date">
            <span>面談の日</span>
            <input type="date" value={view.draft.on} required onInput={(e) => setView({ ...view, draft: { ...view.draft, on: (e.currentTarget as HTMLInputElement).value } })} data-meeting-date />
          </label>
          <fieldset class="mt-group" data-meeting-shared-form>
            <legend>お客さまと一緒に見てよい欄</legend>
            <Area label="話したこと" value={view.draft.shared.talked} onInput={(t) => setView({ ...view, draft: { ...view.draft, shared: { ...view.draft.shared, talked: t } } })} field="talked" />
            <Area label="決めたこと" value={view.draft.shared.decided} onInput={(t) => setView({ ...view, draft: { ...view.draft, shared: { ...view.draft.shared, decided: t } } })} field="decided" />
            <Area label="次までにやること" value={view.draft.shared.todo} onInput={(t) => setView({ ...view, draft: { ...view.draft, shared: { ...view.draft.shared, todo: t } } })} field="todo" />
          </fieldset>
          {((cur) =>
            hideFp && cur.fpOnly ? null : (
              <fieldset class={`mt-group${cur.fpOnly ? " mt-fp" : ""}`} data-meeting-intent-form>
                <legend>保険の意向（どれも任意）</legend>
                <p class="rp-note">保険をおすすめするときに、最初にうかがった意向と、申し込む前に確かめた意向を残します。</p>
                <IntentArea intent={cur.intent} onInput={(next) => setView({ ...view, draft: withIntent(view.draft, next, cur.fpOnly) })} />
                {!hideFp ? (
                  <label class="mt-check">
                    <input type="checkbox" checked={cur.fpOnly} onChange={(e) => setView({ ...view, draft: withIntent(view.draft, cur.intent, (e.currentTarget as HTMLInputElement).checked) })} data-meeting-intent-fp />
                    この意向を FP だけの欄にする（既定はお客さまと一緒に見てよい欄）
                  </label>
                ) : null}
              </fieldset>
            ))(intentOf(view.draft))}
          {!hideFp ? (
            <fieldset class="mt-group mt-fp" data-meeting-fp-form>
              <legend>FP だけ（お客さまには見せない）</legend>
              <Area label="FP のメモ" value={view.draft.fpOnly.note} onInput={(t) => setView({ ...view, draft: { ...view.draft, fpOnly: { ...view.draft.fpOnly, note: t } } })} field="note" />
            </fieldset>
          ) : null}
          <label class="mt-snap-pick">
            <span>その日の控え</span>
            <select
              value={view.snap.kind === "pick" ? view.snap.id : view.snap.kind}
              onChange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value;
                setView({ ...view, snap: v === "take" ? { kind: "take" } : v === "none" ? { kind: "none" } : { kind: "pick", id: v } });
              }}
              data-meeting-snapshot-pick
            >
              {onSnapshot !== undefined ? <option value="take">この時点を残して、つなぐ</option> : null}
              <option value="none">つながない</option>
              {snaps.map((s) => (
                <option key={s.id} value={s.id}>
                  {snapshotDateText(s.createdAt)}（{TRIGGER_TEXT[s.trigger]}
                  {s.memo !== "" ? `・${s.memo}` : ""}）
                </option>
              ))}
              {view.snap.kind === "pick" && !snaps.some((s) => s.id === (view.snap as { id: string }).id) ? <option value={view.snap.id}>（外された控え）</option> : null}
            </select>
          </label>
          <p class="rp-note">お客さまの名前や連絡先は書かないでください（このソフトは顧客の名前を持ちません）。</p>
          <div class="rp-actions">
            <button type="submit" class="btn primary" disabled={busy} data-meeting-save>
              {view.isNew ? "足す" : "直す"}
            </button>
            <button type="button" class="btn" onClick={() => setView(view.isNew ? { kind: "list" } : { kind: "open", id: view.draft.id })}>
              キャンセル
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function Read({ label, text }: { label: string; text: string }) {
  return (
    <div class="mt-read">
      <span class="mt-label">{label}</span>
      {text.trim() !== "" ? <p class="mt-text">{text}</p> : <span class="snap-none">—</span>}
    </div>
  );
}

function IntentRead({ intent }: { intent: InsuranceIntent }) {
  if (intent.initial.trim() === "" && intent.final.trim() === "" && intent.reason.trim() === "") return null;
  return (
    <div class="mt-intent" data-meeting-intent>
      <span class="mt-label">保険の意向</span>
      <Read label="当初の意向" text={intent.initial} />
      <Read label="最終的な意向" text={intent.final} />
      <Read label="違いがあればその理由" text={intent.reason} />
    </div>
  );
}

function Area({ label, value, onInput, field, rows = 3 }: { label: string; value: string; onInput: (t: string) => void; field: string; rows?: number }) {
  return (
    <label class="mt-area">
      <span>{label}</span>
      <textarea rows={rows} value={value} maxLength={MEETING_TEXT_MAX} onInput={(e) => onInput((e.currentTarget as HTMLTextAreaElement).value)} data-meeting-field={field} />
    </label>
  );
}

function IntentArea({ intent, onInput }: { intent: InsuranceIntent; onInput: (i: InsuranceIntent) => void }) {
  const cur = intent ?? EMPTY_INTENT;
  return (
    <>
      <Area label="当初の意向" value={cur.initial} onInput={(t) => onInput({ ...cur, initial: t })} field="intentInitial" rows={2} />
      <Area label="最終的な意向" value={cur.final} onInput={(t) => onInput({ ...cur, final: t })} field="intentFinal" rows={2} />
      <Area label="違いがあればその理由" value={cur.reason} onInput={(t) => onInput({ ...cur, reason: t })} field="intentReason" rows={2} />
    </>
  );
}
