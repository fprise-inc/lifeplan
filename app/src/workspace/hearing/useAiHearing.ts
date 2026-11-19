// AI 接続口から頼まれた Web のヒアリングの発行（0222）を、画面で受けて行う所と、世帯ファイルにまだ入っていない依頼（事務所データ）の状態。
// - 本体の状態（3秒ごとの読み直し）の hearingJobs が1件以上なら、仕事を受け取って発行し（aiHearing.ts の runIssueJob）、置き場所に書いてから答える。
//   置き場所に書けなかったら、サーバーから消してから「発行できなかった」と答える（鍵を失った依頼を残さない）
// - 開いた世帯の依頼が事務所データにあれば、世帯ファイルへ移す（保存できてから事務所データから外す）
// - 事務所データへの書き込みは1つずつ（読み直した最新の値に書き足す）
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { AiHost, AiHearingJob, HearingWebHost, OfficeHost } from "../../engine/host.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { assignTo, cancelIssued, EMPTY_OFFICE_HEARING, markSeen, moveInto, pendingFor, pruned, readOfficeHearing, runIssueJob, withIssued, withPending, type OfficeHearing } from "./aiHearing.ts";
import { webLog, withWebEntry, type WebLogEntry } from "./web.ts";
import { rememberedContact } from "./WebBuilder.tsx";

export interface AiHearingDeps {
  ai: AiHost | null;
  office: OfficeHost | null;
  web: HearingWebHost | null;
  /** 本体の状態の発行の仕事の数（3秒ごとの読み直し） */
  jobs: number;
  /** 事務所の鍵が使えるか */
  ready: boolean;
  /** 開いている保存した世帯（見本・保存していない世帯は null） */
  opened: () => { id: string; wh: WorkingHousehold; readOnly: boolean } | null;
  openedId: string | null;
  edit: (wh: WorkingHousehold) => void;
  saveNow: () => Promise<boolean>;
  look: { name: string; color: string | null };
}

export interface AiHearingState {
  store: OfficeHearing;
  /** 事務所データを置き換える（取り消し・結びつけ・確かめた印） */
  update: (f: (s: OfficeHearing) => OfficeHearing) => Promise<void>;
  /** 帯の「確かめる」: 見た印を付ける */
  seen: () => Promise<void>;
  /** 世帯の決まっていない依頼を、その世帯に結びつける（開いていればすぐ世帯ファイルへ移す） */
  assign: (requestId: string, householdId: string, customerNo: string | null) => Promise<boolean>;
  /** 事務所データの依頼を置き換える（取り消したとき） */
  putEntry: (entry: WebLogEntry) => Promise<void>;
}

export function useAiHearing(d: AiHearingDeps): AiHearingState {
  const [store, setStore] = useState<OfficeHearing>(EMPTY_OFFICE_HEARING);
  const ref = useRef<OfficeHearing>(EMPTY_OFFICE_HEARING);
  const deps = useRef(d);
  deps.current = d;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const busy = useRef(new Set<string>());

  /** 1つずつ（前の書き込みが終わってから） */
  const serial = useCallback(<T,>(f: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(f, f);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  const put = useCallback(async (next: OfficeHearing) => {
    const o = deps.current.office;
    if (o?.putHearingRequests === undefined) throw new Error("E_HOST_NO_OFFICE_HEARING");
    await o.putHearingRequests(next as unknown as Record<string, unknown>);
    ref.current = next;
    setStore(next);
  }, []);

  // 読み込み（事務所の鍵が使えるようになったとき）
  useEffect(() => {
    const o = d.office;
    if (!d.ready || o?.hearingRequests === undefined) return;
    void o.hearingRequests().then(
      (v) => {
        const s = pruned(readOfficeHearing(v), new Date());
        ref.current = s;
        setStore(s);
      },
      () => undefined,
    );
  }, [d.ready, d.office]);

  /** 開いている世帯へ、その世帯の依頼を移す（保存できてから事務所データから外す） */
  const moveOpened = useCallback(
    () =>
      serial(async () => {
        const o = deps.current.opened();
        if (o === null || o.readOnly) return;
        const { take, rest } = pendingFor(ref.current, o.id);
        if (take.length === 0) return;
        const ids = webLog(o.wh).map((e) => e.record.requestId);
        deps.current.edit(moveInto(o.wh, take, ids));
        if (!(await deps.current.saveNow())) return;
        await put(rest);
      }),
    [serial, put],
  );
  useEffect(() => {
    if (d.openedId !== null && store.requests.some((r) => r.householdId === d.openedId)) void moveOpened().catch(() => undefined);
  }, [d.openedId, store, moveOpened]);

  // 発行の仕事: 本体の状態に仕事があると分かっている間は、1秒ごとに受け取りに行く（同じ数のまま次の仕事が来ても止まらないように）
  const pending = d.jobs > 0;
  useEffect(() => {
    if (!pending) return;
    const tick = async () => {
      const { ai, web } = deps.current;
      if (ai?.hearingJobs === undefined || ai.hearingJobDone === undefined) return;
      let list: AiHearingJob[];
      try {
        list = await ai.hearingJobs();
      } catch {
        return;
      }
      for (const job of list) {
        if (busy.current.has(job.jobId)) continue;
        busy.current.add(job.jobId);
        void serial(() => issueOne(job, web))
          .catch(() => ({ ok: false, code: "E_HOST", message: "発行できませんでした。URL は発行していません。" }))
          .then((answer) => ai.hearingJobDone?.(job.jobId, answer as unknown as Record<string, unknown>))
          .catch(() => undefined)
          .finally(() => busy.current.delete(job.jobId));
      }
    };
    /** 1件の発行（置き場所に書けたら答える。書けなければサーバーから消して断る） */
    const issueOne = async (job: AiHearingJob, web: HearingWebHost | null): Promise<unknown> => {
      if (web === null) return { ok: false, code: "E_HOST_NO_HEARING_WEB", message: "このアプリでは Web のヒアリングを使えません。URL は発行していません。" };
      const cur = deps.current;
      const out = await runIssueJob(job, { transport: web.call, config: () => web.config(), office: cur.look, privacyContact: rememberedContact(), opened: cur.opened(), now: new Date() }, ref.current);
      if (!out.answer.ok || out.entry === null) return out.answer;
      const entry = out.entry;
      try {
        if (out.place === "open") {
          const o = cur.opened();
          if (o !== null && o.id === job.householdId) {
            cur.edit(withWebEntry(o.wh, entry));
            if (await cur.saveNow()) {
              await put(withIssued(ref.current, null, null, null, out.log));
              return out.answer;
            }
          }
        }
        // 開いていない世帯の依頼・世帯の決まっていない依頼（開いている世帯に書けなかったときも、鍵を失わないようにここへ）
        await put(withIssued(ref.current, entry, job.householdId, job.customerNumber, out.log));
        return out.answer;
      } catch {
        await cancelIssued(entry, web.call);
        return { ok: false, code: "E_STORE", message: "発行した依頼の記録を保存できなかったので、サーバーから消しました（URL は使えません）。" };
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 1000);
    return () => clearInterval(t);
  }, [pending, serial, put]);

  const update = useCallback((f: (s: OfficeHearing) => OfficeHearing) => serial(() => put(f(ref.current))), [serial, put]);
  const seen = useCallback(() => update(markSeen), [update]);
  const putEntry = useCallback((entry: WebLogEntry) => update((s) => withPending(s, entry)), [update]);
  const assign = useCallback(
    async (requestId: string, householdId: string, customerNo: string | null) => {
      await update((s) => assignTo(s, requestId, householdId, customerNo));
      await moveOpened();
      return !ref.current.requests.some((r) => r.entry.record.requestId === requestId);
    },
    [update, moveOpened],
  );
  return { store, update, seen, assign, putEntry };
}
