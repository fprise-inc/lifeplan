// AI 接続口から発行した Web のヒアリングの URL（0222）: 上の帯「AI が URL を発行しました」と、AI が発行した URL の確認画面（事務所の側の記録と、世帯ファイルに
// まだ入っていない依頼）。
// - 世帯の決まっていない依頼（新しいお客さま向け）は、届いたかを確かめ、「新しい世帯を作って取り込む」か「開いている世帯に取り込む」を選ぶ
//   （選んだ世帯の「発行した URL」に移り、受け取り・取り込みは今までどおりそこで行う）。取り消し・案内文と URL のコピーもここで
// - 渡された世帯の依頼で、その世帯を開いていなかった物は、その世帯を開くと世帯のファイルに移る（ここでは開くボタンだけ）
// - お客さまと一緒に見る画面では顧客番号を出さない（帯は件数だけ。0015 の8）
// - 0222 の追記（2026-11-20）: 利用者の判断で、世帯に結びついた AI の URL は、その世帯の「発行した URL」の表に FP が作った URL と一緒に並べる
//   （hearing/issuedUrls.ts）。帯が消えた後の入口は、表の下の「まだ世帯の決まっていない、AI が発行した URL（N件）」のリンク（AiUnassignedLink。
//   世帯の決まっていない受け付け中の依頼が1件以上のときだけ。AI との接続がオフでも出す。鍵は事務所データにあり、受け取り・取り込みに AI は要らない）
import { useEffect, useRef, useState } from "preact/hooks";
import { CloseX, useEscClose } from "../../presentation/CloseX.tsx";
import type { HearingWebHost } from "../../engine/host.ts";
import { PopIcon } from "../../presentation/icons.tsx";
import { arrivedNow, UNASSIGNED_LIMIT, unassignedAccepting, type AiIssueLog, type OfficeHearing, type PendingWebRequest } from "../hearing/aiHearing.ts";
import { accepting, ARRIVAL_INTERVAL_MS, CANCEL_ASK_TEXT, arrivalOf, checkAnswered, invitationText, noteArrival, onArrivals, removeOnServer, selectionName, STATUS_TEXT, statusOf, type WebLogEntry } from "../hearing/web.ts";
import { unassignedLink } from "../hearing/issuedUrls.ts";
import { dateTimeText } from "./model.ts";
import { listDate } from "../../dates.ts";

/** 帯（FP がまだ確かめていない、AI が発行した URL の数と、AI が発行した URL の確認画面を開くボタン） */
export function AiHearingBand({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <div class="ai-code-band" role="status" data-ai-hearing-band>
      <b>AI が URL を発行しました（{count}件）</b>
      <span class="pl-sub">ヒアリングの URL です。中身を確認し、要らなければ取り消せます</span>
      <button type="button" class="link-btn" onClick={onOpen} data-ai-hearing-band-open>
        AI が発行した URL の確認画面を開く
        <PopIcon />
      </button>
    </div>
  );
}

/** 届いたかを確かめた結果を覚える（一覧の「届いたかを確かめる」と入口の確かめで同じ形） */
async function checkOne(entry: WebLogEntry, web: HearingWebHost): Promise<Awaited<ReturnType<typeof checkAnswered>>> {
  const a = await checkAnswered(entry, web.call);
  noteArrival(entry.record.requestId, a === null ? null : { answers: a.newAnswers, batches: a.batches, submitted: a.answered, at: new Date().toISOString() });
  return a;
}

export interface AiUnassignedLinkProps {
  store: OfficeHearing;
  web: HearingWebHost | null;
  /** 「AI が発行した URL」を開く（上の帯の「確かめる」と同じ操作） */
  onOpen: () => void;
}

/** 入口を出したときに確かめ直すか（まだ確かめていないか、「まだ届いていない」と確かめてから、開いている世帯の確かめの間隔〔5分〕が過ぎた） */
export function staleArrival(requestId: string, now: Date): boolean {
  const a = arrivalOf(requestId);
  if (a === undefined) return true;
  if (a.answers || a.batches > 0) return false;
  return now.getTime() - Date.parse(a.at) >= ARRIVAL_INTERVAL_MS;
}

/**
 * 「発行した URL」の表の下の「まだ世帯の決まっていない、AI が発行した URL（N件）」のリンク（帯が消えた後の入口。0222 の追記 2026-11-20）。
 * 世帯の決まっていない受け付け中の依頼が1件以上のときだけ出す（AI との接続がオフでも。受け取り・取り込みに AI は要らない）。
 * 出したとき、世帯の決まっていない受け付け中の依頼で、まだ確かめていない物（前の確かめから5分を過ぎた物も）を確かめる。
 * 開いている世帯の依頼のように5分ごとには確かめない（世帯の決まっていない依頼は、取り込むを開いたときと一覧の「届いたかを確かめる」で）
 */
export function AiUnassignedLink({ store, web, onOpen }: AiUnassignedLinkProps) {
  const [, setTick] = useState(0);
  const checked = useRef(new Set<string>());
  useEffect(() => onArrivals(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    if (web === null) return;
    const now = new Date();
    for (const r of store.requests) {
      const id = r.entry.record.requestId;
      if (r.householdId !== null || !accepting(r.entry, now) || !staleArrival(id, now) || checked.current.has(id)) continue;
      checked.current.add(id);
      void checkOne(r.entry, web).catch(() => undefined);
    }
  }, [web, store]);
  const { count, arrived } = unassignedLink(store, new Date());
  if (count === 0) return null;
  return (
    <p class="hs-ai-issued" data-ai-hearing-entry>
      <button type="button" class="link-btn" onClick={onOpen} data-ai-hearing-entry-open>
        まだ世帯の決まっていない、AI が発行した URL（{count}件）
        <PopIcon />
      </button>
      {arrived > 0 ? (
        <b class="hs-kind answered" data-ai-hearing-entry-arrived>
          届いています（{arrived}件）
        </b>
      ) : null}
    </p>
  );
}

export interface AiHearingPanelProps {
  store: OfficeHearing;
  web: HearingWebHost | null;
  officeName: string;
  /** 開いている保存した世帯（閲覧だけなら取り込めない） */
  opened: { id: string; customerNo: string; readOnly: boolean } | null;
  /** 事務所データの依頼を置き換える（取り消したとき） */
  onEntry: (entry: WebLogEntry) => Promise<void>;
  /** 開いている世帯へ移す。移せたら true */
  onAssignOpened: (requestId: string) => Promise<boolean>;
  /** 新しい世帯を作って移す（作った世帯を開く）。失敗の文か null */
  onCreate: (requestId: string) => Promise<string | null>;
  onOpenHousehold: (householdId: string) => void;
  onClose: () => void;
}

export function AiHearingPanel(p: AiHearingPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  useEffect(() => onArrivals(() => setTick((n) => n + 1)), []);
  useEscClose(p.onClose);
  const now = new Date();
  const note = (id: string, text: string) => setMsg((m) => ({ ...m, [id]: text }));
  const run = async (id: string, f: () => Promise<void>) => {
    setBusy(id);
    try {
      await f();
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      note(id, code === "E_RELAY_UNREACHABLE" ? "受け付けのサーバーにつながりませんでした" : `できませんでした（${code}）`);
    } finally {
      setBusy(null);
    }
  };
  const pendingOf = (id: string): PendingWebRequest | undefined => p.store.requests.find((r) => r.entry.record.requestId === id);
  // 記録の無い依頼（前の版で置いた物など）も並べる
  const logs: AiIssueLog[] = [...p.store.log].reverse();
  const extra = p.store.requests.filter((r) => !p.store.log.some((l) => l.requestId === r.entry.record.requestId));
  const copy = (id: string, label: string, text: string) => void navigator.clipboard?.writeText(text).then(() => note(id, `${label}を写しました`), () => note(id, "写せませんでした"));
  const unassigned = unassignedAccepting(p.store, now);

  const row = (l: AiIssueLog | null, r: PendingWebRequest | undefined) => {
    const id = l?.requestId ?? r?.entry.record.requestId ?? "";
    const e = r?.entry;
    const arrived = arrivalOf(id);
    const st = e === undefined ? null : statusOf(e, now, arrived?.submitted === true);
    const live = e !== undefined && accepting(e, now);
    const where =
      r === undefined
        ? `顧客番号 ${l?.customerNo ?? "—"} の世帯の「発行した URL」にあります`
        : r.householdId === null
          ? "世帯の決まっていない依頼（新しいお客さま向け）"
          : `顧客番号 ${r.customerNo ?? "—"} の世帯の依頼（その世帯を開くと「発行した URL」に並びます）`;
    return (
      <li key={id} class={`wr-row${st !== null ? ` st-${st}` : ""}`} data-ai-hearing-row={id} data-ai-hearing-place={r === undefined ? "household" : r.householdId === null ? "new" : "waiting"}>
        <div class="wr-h">
          <b>{id}</b>
          {st !== null ? <span class={`hs-kind wr-st ${st}`}>{STATUS_TEXT[st]}</span> : null}
          {e !== undefined && arrivedNow(e, now) ? (
            <span class="hs-kind wr-st answered" data-ai-hearing-arrived>
              届いています
            </span>
          ) : null}
          <span class="hs-kind wr-origin">AI が発行</span>
          <small>
            発行 {dateTimeText(l?.at ?? e?.record.issuedAt ?? "")}
            {e !== undefined ? `・期限 ${listDate(e.record.expiresAt)}` : ""}
            {l?.connector != null ? `・${l.connector}` : ""}
          </small>
        </div>
        <p class="rp-note wr-what">
          {e !== undefined ? selectionName(e.record.selection) : (l?.name ?? "")}（聞く項目 {l?.selectedCount ?? "—"}）{l?.review === true ? "・見直し（今の値を見せる。URL は AI に返していません）" : ""}・{where}
        </p>
        <div class="rp-actions">
          {r !== undefined && live && p.web !== null ? (
            <>
              <button
                type="button"
                class="btn"
                disabled={busy !== null}
                onClick={() =>
                  void run(id, async () => {
                    const a = await checkOne(r.entry, p.web as HearingWebHost);
                    note(id, a === null ? "サーバーにありません（期限が過ぎたか、消しました）" : a.newAnswers || a.batches > 0 ? "届いています。取り込む世帯を選んでください" : "まだ届いていません");
                  })
                }
                data-ai-hearing-check
              >
                届いたかを確認する
              </button>
              {r.householdId === null ? (
                <>
                  <button type="button" class="btn primary" disabled={busy !== null} onClick={() => void run(id, async () => note(id, (await p.onCreate(id)) ?? "新しい世帯を作り、その世帯の「発行した URL」に移しました"))} data-ai-hearing-create>
                    新しい世帯を作って取り込む
                  </button>
                  {p.opened !== null && !p.opened.readOnly ? (
                    <button type="button" class="btn" disabled={busy !== null} onClick={() => void run(id, async () => note(id, (await p.onAssignOpened(id)) ? `顧客番号 ${p.opened?.customerNo ?? ""} の世帯の「発行した URL」に移しました` : "移せませんでした（世帯を保存できませんでした）"))} data-ai-hearing-assign>
                      開いている世帯（顧客番号 {p.opened.customerNo}）に取り込む
                    </button>
                  ) : null}
                </>
              ) : (
                <button type="button" class="btn" onClick={() => p.onOpenHousehold(r.householdId as string)} data-ai-hearing-open-household>
                  この世帯を開く
                </button>
              )}
              <button type="button" class="btn" onClick={() => copy(id, "案内文", invitationText(r.entry, p.officeName))} data-ai-hearing-copy-invitation>
                案内文をコピー
              </button>
              <button type="button" class="btn" onClick={() => copy(id, "URL", r.entry.record.url)} data-ai-hearing-copy-url>
                URL をコピー
              </button>
              <button type="button" class="btn" disabled={busy !== null || asking === id} onClick={() => setAsking(id)} aria-expanded={asking === id} data-ai-hearing-cancel>
                取り消す
              </button>
            </>
          ) : null}
        </div>
        {/* URL の取り消しの確認（「発行した URL」の取り消しの確認と同じ形・同じ言葉。元のボタンと別の段に出す） */}
        {asking === id && r !== undefined && live && p.web !== null ? (
          <div class="wr-ask" role="alertdialog" aria-label="URL の取り消しの確認" data-ai-hearing-cancel-ask>
            <span>{CANCEL_ASK_TEXT}</span>
            <span class="wr-ask-acts">
              <button
                type="button"
                class="btn danger"
                disabled={busy !== null}
                onClick={() =>
                  void run(id, async () => {
                    await removeOnServer(r.entry, (p.web as HearingWebHost).call);
                    await p.onEntry({ ...r.entry, state: "cancelled" });
                    setAsking(null);
                    note(id, "取り消しました（サーバーから消しました）");
                  })
                }
                data-ai-hearing-cancel-yes
              >
                はい、取り消す
              </button>
              <button type="button" class="btn" onClick={() => setAsking(null)} data-ai-hearing-cancel-no>
                やめる
              </button>
            </span>
          </div>
        ) : null}
        {msg[id] !== undefined ? (
          <p class="rp-note" role="status">
            {msg[id]}
          </p>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={p.onClose} />
      <div ref={panel} class="rk-panel ai-panel" role="dialog" aria-modal="true" aria-labelledby="ai-hearing-title" tabIndex={-1} data-ai-hearing-panel>
        <CloseX onClose={p.onClose} what="AI が発行した URL" />
        <h2 id="ai-hearing-title">AI が発行した URL</h2>
        <p class="in-note">
          AI から発行した、Web のヒアリングの URL です。アプリはメールを送りません（URL を送るのは FP です）。要らない URL は「取り消す」でお客さまが開けなくなります。世帯の決まっていない依頼は、答えが届いたら取り込む世帯を選んでください（受け付け中は{UNASSIGNED_LIMIT}件まで。今 {unassigned}件）。
        </p>
        {logs.length === 0 && extra.length === 0 ? <p class="rp-note">AI が発行した URL はありません。</p> : null}
        <ul class="wr-list">
          {logs.map((l) => row(l, pendingOf(l.requestId)))}
          {extra.map((r) => row(null, r))}
        </ul>
        <div class="rp-actions">
          <button type="button" class="btn" onClick={p.onClose}>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}
