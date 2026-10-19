// 保存先の設定（中央のパネル。0024）: 1人の FP が2台の PC で使うための同期フォルダ。
// - 既定は「このPCの中」。同期フォルダを選ぶと、世帯を暗号化したまま移す（同期フォルダは本体が OS のダイアログで選ばせる。画面はパスを持たない）
// - 今の復元キーをそのまま使う。保管していなければ移さない（2台目の PC で開くときに要る）
// - 2台目の PC: 「すでに使っている同期フォルダを開く」で、同じフォルダを選んで復元キーを入れる。開いた後は復元キーなしで使える
// - PC の一覧（このPC・復元キーで開いた PC）と、なくした PC を外す（同期フォルダの鍵の入れ替え。復元キーも新しくなる）
// - この PC の中へ戻す（もう1台の PC で開いている間はしない）
// 複数の FP の事務所での共有は「事務所の共有」のパネル（OfficePanel）。こちらは PC の言葉（呼び名）だけを使い、人の名前・指紋・承認は出さない
import { useEffect, useRef, useState } from "preact/hooks";
import type { OfficeHost, OfficeStatus, StorageNotice, StoreStatus } from "../../engine/host.ts";
import { shortDate } from "./HouseholdPanel.tsx";
import { storageNoticeText, syncMessage } from "./storage.ts";

export interface StoragePanelProps {
  office: OfficeHost;
  status: OfficeStatus | null;
  /** この PC の中の事務所の状態（復元キーを保管したか） */
  storeStatus: StoreStatus | null;
  notices: StorageNotice[];
  /** 2台目の PC として開く節を先に出す（初回の案内から来たとき） */
  focus?: "open" | null;
  onStatus: (s: OfficeStatus) => void;
  /** 世帯を移した・開いた（世帯の一覧と通知を読み直す） */
  onHouseholdsChanged: () => void;
  /** 復元キーのパネルを開く */
  onRecovery: () => void;
  /** 事務所の共有のパネルを開く */
  onOffice: () => void;
  onClose: () => void;
}

const codeOf = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "E_SYNC");

export function StoragePanel(p: StoragePanelProps) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [removing, setRemoving] = useState<{ id: string; name: string; value: string } | null>(null);
  const [removedDone, setRemovedDone] = useState<string | null>(null);
  const [ending, setEnding] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const st = p.status;

  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: syncMessage(codeOf(e)) });
      // 途中で止まった操作（世帯の一部だけを移した、など）もあるので、状態を読み直す
      void p.office.status().then(p.onStatus, () => undefined);
      p.onHouseholdsChanged();
    } finally {
      setBusy(false);
    }
  };

  const nameOk = name.trim() !== "" && [...name.trim()].length <= 20;
  const recoveryOk = p.storeStatus?.recoveryAcknowledged === true || (p.storeStatus?.recoveryVerifiedAt ?? null) !== null;
  const personal = st?.usage === "personal";
  const me = st?.members.find((m) => m.isMe) ?? null;
  const nameField = (
    <label class="of-name">
      このPCの呼び名
      <input value={name} maxLength={20} placeholder="例: 事務所のPC・自宅のノート" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} data-sync-name />
      <span class="pl-sub">もう1台のPCに「○○で開いています」と出す名前です。顧客のお名前は入れないでください</span>
    </label>
  );
  // このパネルの中で詳しく出す通知（復元キー・PC が加わった・申請・移していない世帯・使えない理由）は除き、残り（同期の衝突の写し）だけを並べる
  const notices = p.notices.filter((n) => n.kind === "syncCopies");

  const startSection = (
    <section class="sp-section" data-sync-start-section>
      <h3>同期フォルダに置いて、2台のPCで使う</h3>
      <p class="pl-sub">
        同期サービスの同期フォルダを選ぶと、このPCの世帯（{st?.localHouseholds ?? 0}件）を<b>暗号化したまま</b>そのフォルダへ移します。もう1台のPCで同じフォルダを開くと、同じ世帯を開けます。
      </p>
      {!recoveryOk ? (
        <div class="of-lock" role="status" data-sync-needs-recovery>
          <p>
            <b>先に復元キーを保管してください。</b>2台目のPCで同期フォルダを開くときに、復元キーを入れます（今の復元キーをそのまま使います）。
          </p>
          <button type="button" class="btn primary" onClick={p.onRecovery} data-sync-recovery-go>
            復元キーを保管する
          </button>
        </div>
      ) : null}
      <button
        type="button"
        class="btn primary"
        disabled={busy || !nameOk || !recoveryOk}
        onClick={() =>
          void run(async () => {
            const r = await p.office.syncStart(name);
            if (r === null) return;
            p.onStatus(r);
            p.onHouseholdsChanged();
            setMsg({ ok: true, text: "保存先を同期フォルダにしました。もう1台のPCでは「すでに使っている同期フォルダを開く」から開いてください" });
          })
        }
        data-sync-start
      >
        同期フォルダを選んで移す
      </button>
    </section>
  );
  const openSection = (
    <section class="sp-section" data-sync-open-section>
      <h3>すでに使っている同期フォルダを開く（2台目のPC）</h3>
      <p class="pl-sub">
        1台目のPCで選んだ同期フォルダと<b>同じフォルダ</b>を選び、<b>復元キー</b>を入れます。開いた後は、このPCの保管庫に鍵を置くので、ふだんは復元キーは要りません。
        このPCが加わったことは、1台目のPCにも通知が出ます。
      </p>
      <label class="of-name">
        復元キー
        <input value={key} onInput={(e) => setKey((e.currentTarget as HTMLInputElement).value)} placeholder="XXXX-XXXX-…（72文字）" autoComplete="off" spellcheck={false} class="of-key-input" data-sync-key />
      </label>
      <button
        type="button"
        class="btn"
        disabled={busy || !nameOk || key.trim() === ""}
        onClick={() =>
          void run(async () => {
            const r = await p.office.syncOpen(name, key);
            if (r === null) return;
            setKey("");
            p.onStatus(r);
            p.onHouseholdsChanged();
            setMsg({ ok: true, text: "同期フォルダを開きました。次からは復元キーなしで使えます" });
          })
        }
        data-sync-open
      >
        同期フォルダを選んで開く
      </button>
    </section>
  );

  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={p.onClose} />
      <div ref={panel} class="rk-panel of-panel" role="dialog" aria-modal="true" aria-labelledby="sp-title" tabIndex={-1} data-storage-panel={st === null ? "loading" : st.state === "off" ? "local" : personal ? `sync-${st.state}` : "office"}>
        <h2 id="sp-title">保存先</h2>
        {st === null ? <p>読み込んでいます…</p> : null}
        {notices.length > 0 && st !== null && st.state !== "off" ? (
          <ul class="sp-notices" data-storage-notices>
            {notices.map((n) => (
              <li key={`${n.kind}-${n.at ?? ""}`} class={`sp-n-${n.level}`}>
                {storageNoticeText(n)}
              </li>
            ))}
          </ul>
        ) : null}
        {st?.state === "off" ? (
          <>
            <p>
              保存先: <b>このPCの中</b>（既定）。世帯ごとに暗号化して、このPCのアプリのデータの場所に保存しています。1台のPCで使うときは、このままで構いません。
            </p>
            {nameField}
            {p.focus === "open" ? (
              <>
                {openSection}
                {startSection}
              </>
            ) : (
              <>
                {startSection}
                {openSection}
              </>
            )}
            <h3>知っておいてほしいこと</h3>
            <ul class="of-notes">
              <li>同期フォルダには、世帯を暗号化したまま置きます。同期サービスの側からも中身は読めません。提供元のサーバーは使いません。</li>
              <li>同期サービスの版の履歴には、暗号化された古い写しが残ります。完全削除の後も読めなくしたいときは、版の履歴から消すか、なくしたPCを外して鍵を入れ替えてください。</li>
              <li>2台のPCで同じ世帯を同時に直したときは、後から保存したほうが分岐として残り、どちらを残すか選べます。もう1台のPCで開いている世帯には「もう1台のPCで開いています」と出ます。</li>
              <li>毎日の自動バックアップは、それぞれのPCの中（アプリのデータの場所）に作ります。同期フォルダには置きません。</li>
              <li>
                複数のFPで同じ世帯を使うときは、こちらではなく
                <button type="button" class="link-btn" onClick={p.onOffice} data-sync-to-office>
                  事務所の共有
                </button>
                を使ってください。
              </li>
            </ul>
          </>
        ) : null}
        {st !== null && st.state !== "off" && !personal ? (
          <>
            <p data-storage-office>
              今は<b>事務所の共有</b>で、事務所の共有フォルダに保存しています（複数のFPで使う形）。保存先の設定は「事務所の共有」から行います。
            </p>
            <button type="button" class="btn" onClick={p.onOffice}>
              事務所の共有を開く
            </button>
          </>
        ) : null}
        {personal && st?.state === "removed" ? (
          <>
            <p class="hh-warn">このPCは、同期フォルダから外されました。同期フォルダの世帯は、このPCでは開けません。</p>
            <button type="button" class="btn" disabled={busy} onClick={() => void run(async () => (p.onStatus(await p.office.cancel()), p.onHouseholdsChanged()))} data-sync-back-local>
              このPCの中に戻る
            </button>
          </>
        ) : null}
        {personal && st?.state === "unavailable" ? (
          <>
            <p class="hh-warn">{syncMessage(st.problem ?? "E_OFFICE_UNAVAILABLE")}</p>
            {st.problem === "E_OFFICE_CLOSED" ? <p class="pl-sub">世帯は、もう1台のPCの中にあります。このPCの中に戻ると、このPCの中の世帯だけになります。</p> : null}
            <div class="rk-row">
              <button type="button" class="btn" disabled={busy} onClick={() => void run(async () => p.onStatus(await p.office.status()))}>
                確かめ直す
              </button>
              {st.problem === "E_OFFICE_CLOSED" || st.problem === "E_OFFICE_KEY_MISSING" ? (
                <button type="button" class="btn" disabled={busy} onClick={() => void run(async () => (p.onStatus(await p.office.cancel()), p.onHouseholdsChanged()))} data-sync-back-local>
                  このPCの中に戻る
                </button>
              ) : null}
            </div>
          </>
        ) : null}
        {personal && st?.state === "member" ? (
          <>
            <p>
              保存先: <b>同期フォルダ</b>
              {st.syncFolder ? "" : "（選んだフォルダは、OS の同期サービスの場所の外です。もう1台のPCから見えるか確かめてください）"}。このPCの呼び名は <b>{st.myName}</b>。
            </p>
            {st.notices.length > 0 ? (
              <div class="of-alert" role="alert" data-sync-notice>
                {st.notices.map((n) => (
                  <p key={`${n.name}-${n.at}`}>
                    <b>復元キーで「{n.name}」が同期フォルダを開きました</b>（{shortDate(n.at)}）。
                  </p>
                ))}
                <p class="pl-sub">復元キーを持つ人は、承認なしで同期フォルダを開けます。心当たりが無いときは、すぐにそのPCを外し（復元キーも新しくなります）、復元キーの控えの置き場所を確かめてください。</p>
                <button type="button" class="btn" disabled={busy} onClick={() => void run(async () => p.onStatus(await p.office.dismissNotices()))} data-sync-notice-ok>
                  確かめた
                </button>
              </div>
            ) : null}
            {st.requests.length > 0 ? (
              <div class="of-alert" role="alert" data-sync-requests>
                <p>
                  <b>この同期フォルダに、参加の申請が置かれています。</b>1人で使う同期フォルダなので、承認はできません。心当たりが無ければ断り、同期フォルダの共有の設定（同期サービス側）を確かめてください。
                </p>
                {st.requests.map((r) => (
                  <p key={r.requestId}>
                    「{r.name}」（{shortDate(r.requestedAt)}）{" "}
                    <button type="button" class="link-btn danger" disabled={busy} onClick={() => void run(async () => p.onStatus(await p.office.reject(r.requestId)))}>
                      断る
                    </button>
                  </p>
                ))}
              </div>
            ) : null}
            {removedDone !== null ? (
              <div class="of-alert" role="status" data-sync-removed-done>
                <p>
                  <b>「{removedDone}」を外し、同期フォルダの鍵とすべての世帯の鍵を入れ替えました。</b>新しい復元キーを保管して、古い控えは破棄してください。
                </p>
              </div>
            ) : null}
            {st.recoveryRequired ? (
              <div class="of-lock" role="status" data-sync-locked>
                <p>
                  <b>新しい復元キーがまだ保管されていません。</b>PCを外すと、同期フォルダの復元キーは新しくなります。保管するまで、次にPCを外す操作は止めています（世帯を開く・直すことはできます）。
                </p>
                <button type="button" class="btn primary" onClick={p.onRecovery} data-sync-locked-go>
                  復元キーを保管する
                </button>
              </div>
            ) : null}
            <h3>この同期フォルダを使うPC（{st.members.length}）</h3>
            <div class="plan-list-wrap">
              <table class="plan-list of-members">
                <thead>
                  <tr>
                    <th>呼び名</th>
                    <th>加えた日</th>
                    <th>加え方</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {st.members.map((m) => (
                    <tr key={m.memberId} data-sync-pc={m.name}>
                      <td>
                        <b>{m.name}</b>
                        {m.isMe ? <span class="pl-tag">このPC</span> : null}
                      </td>
                      <td class="num">{shortDate(m.joinedAt).slice(0, 10)}</td>
                      <td>{m.viaRecovery ? "復元キーで開いた" : "最初に同期フォルダを選んだ"}</td>
                      <td>
                        {!m.isMe ? (
                          <button
                            type="button"
                            class="link-btn danger"
                            disabled={st.recoveryRequired}
                            title={st.recoveryRequired ? "新しい復元キーを保管するまで外せません" : undefined}
                            onClick={() => {
                              setRemovedDone(null);
                              setRemoving({ id: m.memberId, name: m.name, value: "" });
                            }}
                            data-sync-remove={m.name}
                          >
                            外す（なくした・手放したPC）
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {removing !== null ? (
              <div class="of-remove" role="alert" data-sync-remove-confirm>
                <p>
                  <b>「{removing.name}」を外すと</b>、同期フォルダの鍵とすべての世帯の鍵を入れ替え、これから保存する内容は「{removing.name}」では読めなくなります。<b>復元キーも新しくなります</b>（このPCともう1台のPCの両方で）。
                </p>
                <p>
                  ただし、<b>「{removing.name}」に既に同期された写しは、このアプリからは消せません</b>。なくしたPCなら、同期サービスのアカウントのパスワードを変え、そのPCをサインアウトさせてください。
                </p>
                <label>
                  確認のためPCの呼び名（{removing.name}）を入れてください{" "}
                  <input value={removing.value} onInput={(e) => setRemoving({ ...removing, value: (e.currentTarget as HTMLInputElement).value })} data-sync-remove-input />
                </label>
                <div class="rk-row">
                  <button
                    type="button"
                    class="btn danger"
                    disabled={busy || removing.value.trim() !== removing.name}
                    onClick={() =>
                      void run(async () => {
                        p.onStatus(await p.office.remove(removing.id, removing.value));
                        setRemovedDone(removing.name);
                        setRemoving(null);
                      })
                    }
                    data-sync-remove-go
                  >
                    外す（鍵を入れ替える）
                  </button>
                  <button type="button" class="link-btn" onClick={() => setRemoving(null)}>
                    キャンセル
                  </button>
                </div>
              </div>
            ) : null}
            {st.localHouseholds > 0 ? (
              <p>
                このPCの中に、まだ同期フォルダへ移していない世帯が {st.localHouseholds}件 あります。{" "}
                <button
                  type="button"
                  class="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const n = await p.office.moveLocal();
                      p.onStatus(await p.office.status());
                      p.onHouseholdsChanged();
                      setMsg({ ok: true, text: `${n}件の世帯を同期フォルダへ移しました` });
                    })
                  }
                  data-sync-move
                >
                  同期フォルダへ移す
                </button>
              </p>
            ) : null}
            <h3>復元キー</h3>
            <p>
              {st.recoveryAcknowledged ? `保管済み（${shortDate(st.recoveryAcknowledgedAt ?? "")}）` : "まだ保管されていません。"}{" "}
              <button type="button" class="link-btn" onClick={p.onRecovery}>
                復元キーを表示・保管する
              </button>
            </p>
            <p class="pl-sub">同期フォルダの復元キーは、どのPCでも同じです。新しいPCで開くとき・PCの保管庫の鍵がなくなったときに使います。</p>
            <h3>バックアップ</h3>
            <p class="pl-sub">毎日の自動バックアップは、それぞれのPCの中（アプリのデータの場所）に作ります。同期フォルダには置きません（同期フォルダの中の誤った削除が、バックアップにまで広がらないように）。</p>
            <h3>このPCの中へ戻す</h3>
            {ending === null ? (
              <p>
                同期フォルダの世帯（暗号化したまま）をこのPCの中へ移し、このPCだけで使う形に戻します。{" "}
                <button type="button" class="btn" disabled={busy} onClick={() => setEnding("")} data-sync-end>
                  このPCの中へ戻す…
                </button>
              </p>
            ) : (
              <div class="of-remove" role="alert" data-sync-end-confirm>
                <p>
                  同期フォルダの世帯をすべてこのPCの中へ移し、開けることを確かめてから、同期フォルダの世帯ファイルと鍵の札を消します。
                  {st.members.length > 1 ? <b>もう1台のPCでは、同期フォルダの世帯を開けなくなります。</b> : null}
                </p>
                {st.members.length > 1 ? <p class="pl-sub">先に、もう1台のPCでファイナンシアを閉じ、同期が終わるのを待ってください（もう1台のPCで世帯を開いている間は戻せません）。</p> : null}
                <p class="pl-sub">同期サービスの版の履歴には、暗号化された古い写しが残ります。</p>
                <label>
                  確認のため、このPCの呼び名（{me?.name ?? st.myName}）を入れてください{" "}
                  <input value={ending} onInput={(e) => setEnding((e.currentTarget as HTMLInputElement).value)} data-sync-end-input />
                </label>
                <div class="rk-row">
                  <button
                    type="button"
                    class="btn danger"
                    disabled={busy || ending.trim() !== (me?.name ?? st.myName ?? "")}
                    onClick={() =>
                      void run(async () => {
                        p.onStatus(await p.office.syncEnd(ending));
                        setEnding(null);
                        p.onHouseholdsChanged();
                        setMsg({ ok: true, text: "保存先をこのPCの中へ戻しました。世帯はこのPCの中にあります" });
                      })
                    }
                    data-sync-end-go
                  >
                    このPCの中へ戻す
                  </button>
                  <button type="button" class="link-btn" onClick={() => setEnding(null)}>
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}
        {msg !== null ? (
          <p class={msg.ok ? "rk-ok" : "hh-err"} role="status" data-sync-msg>
            {msg.text}
          </p>
        ) : null}
        <div class="rk-foot">
          <button type="button" class="btn" onClick={p.onClose}>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}
