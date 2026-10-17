// 案の一覧と比較（作業の層）。配置は仮: 一覧（並べ替え・印で絞る・開く・土台にする・名前と印・現状に反映・外す）、
// その下に比較のグラフ・比較の数字の表・キャッシュフロー表（案ごと／2つの案の差）を、独立した部品のまま並べる。
// 比較は案を5つまで選ぶ（現状はいつも灰の破線で重ねる）。数字は本体の正の計算（quickjs-ng）の結果だけで作る
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { HostApi } from "../../engine/host.ts";
import { isEngineError, type PreviewResult } from "../../engine/types.ts";
import { CompareChart, CompareTable } from "../../presentation/Compare.tsx";
import { man } from "../../presentation/format.ts";
import { CashflowTable } from "../../presentation/MainView.tsx";
import type { CashflowTableModel } from "../../presentation/model.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { cashflowTable, diffCashflowTable, displayYears } from "../present.ts";
import { compareChart, compareTable, metricsOf, type PlanMetrics } from "./compare.ts";
import type { Catalog } from "./items.ts";
import { applyValues, changesOf, deletePlan, effectiveValues, renamePlan, type Proposal } from "./plans.ts";

export const MAX_COMPARE = 5;

type SortKey = "name" | "created" | "target" | "depletion" | "takeHome";

export interface PlansTabProps {
  wh: WorkingHousehold;
  catalog: Catalog;
  host: HostApi | null;
  targetAge: number;
  selected: string[];
  /** 比べる案を選び直す（前の選び方から作る） */
  onSelect: (f: (prev: string[]) => string[]) => void;
  onOpenPlan: (id: string) => void;
  onBaseNew: (id: string) => void;
  onReflect: (id: string) => void;
  onEdit: (wh: WorkingHousehold) => void;
  /** 比較の数字が出るまでの時間（速さの計測） */
  onTiming?: (t: { ms: number; hostMs: number; slots: number }) => void;
}

const dateText = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m === null ? iso : `${Number(m[1])}/${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`;
};

export function PlansTab(p: PlansTabProps) {
  const { wh, catalog: cat, host } = p;
  const plans = wh.proposals;
  const [results, setResults] = useState<Map<string, PreviewResult>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "created", asc: true });
  const [tag, setTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; tags: string } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "delete" | "reflect" } | null>(null);
  const [cf, setCf] = useState<{ a: string; b: string; mode: "a" | "b" | "diff" }>({ a: "current", b: "", mode: "diff" });
  const cache = useRef(new Map<string, PreviewResult>());
  const run = useRef(0);

  // 要求（案ごと。現状の世帯に差分を当てたもの）
  const requests = useMemo(() => {
    const out = new Map<string, string>();
    out.set("current", JSON.stringify(wh.request));
    for (const x of plans) out.set(x.id, JSON.stringify(applyValues(wh, effectiveValues(plans, x.id), cat)));
    return out;
  }, [wh, plans, cat]);

  // 本体で正の計算: 選んだ案と現状を先に、残りの案（一覧の並べ替え用）を後に
  useEffect(() => {
    if (host === null) return;
    const my = ++run.current;
    const fromCache = () => {
      const m = new Map<string, PreviewResult>();
      for (const [id, text] of requests) {
        const r = cache.current.get(text);
        if (r !== undefined) m.set(id, r);
      }
      return m;
    };
    setResults(fromCache());
    const first = ["current", ...p.selected].filter((id) => requests.has(id));
    const rest = [...requests.keys()].filter((id) => !first.includes(id));
    void (async () => {
      for (const ids of [first, rest]) {
        const todo = ids.filter((id) => !cache.current.has(requests.get(id) as string));
        if (todo.length === 0) continue;
        const t0 = performance.now();
        try {
          const res = await host.compute(todo.map((id) => ({ id, rev: 1, request: requests.get(id) as string })));
          if (my !== run.current) return;
          for (const id of todo) {
            const r = res.slots[id]?.result;
            if (r === undefined) continue;
            if (isEngineError(r)) setError(r.error.code);
            else cache.current.set(requests.get(id) as string, r);
          }
          if (ids === first) p.onTiming?.({ ms: performance.now() - t0, hostMs: res.ms, slots: todo.length });
        } catch (e) {
          setError(typeof e === "string" ? e : "E_HOST");
        }
        setResults(fromCache());
      }
    })();
  }, [requests, host, p.selected.join(",")]);

  const metrics = useMemo(() => {
    const m = new Map<string, PlanMetrics>();
    for (const [id, r] of results) m.set(id, metricsOf(wh.request, r.table, p.targetAge));
    return m;
  }, [results, wh.request, p.targetAge]);

  const allTags = [...new Set(plans.flatMap((x) => x.tags))];
  const rows = plans
    .filter((x) => tag === null || x.tags.includes(tag))
    .slice()
    .sort((a, b) => {
      const ma = metrics.get(a.id);
      const mb = metrics.get(b.id);
      const num = (m: PlanMetrics | undefined, k: SortKey) => (m === undefined ? Number.NEGATIVE_INFINITY : k === "target" ? m.target : k === "takeHome" ? m.takeHome : (m.depletion ?? 9999));
      const d = sort.key === "name" ? a.name.localeCompare(b.name, "ja") : sort.key === "created" ? (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) : num(ma, sort.key) - num(mb, sort.key);
      return sort.asc ? d : -d;
    });
  const sortBtn = (k: SortKey, label: string) => (
    <button type="button" class={`sort${sort.key === k ? " on" : ""}`} onClick={() => setSort({ key: k, asc: sort.key === k ? !sort.asc : true })} aria-label={`${label}で並べ替える`}>
      {label}
      {sort.key === k ? (sort.asc ? " ▲" : " ▼") : ""}
    </button>
  );
  const toggle = (id: string) => {
    p.onSelect((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < MAX_COMPARE ? [...prev, id] : prev));
  };

  // 比べる案は一覧の順（作った順）に並べる
  const chosen = plans.filter((x): x is Proposal => p.selected.includes(x.id));
  const cur = results.get("current");
  const ready = cur !== undefined && chosen.every((x) => results.has(x.id));
  const comparedCurrent = cur !== undefined ? { name: "現状", table: cur.table } : null;
  const comparedPlans = chosen.flatMap((x) => {
    const r = results.get(x.id);
    return r === undefined ? [] : [{ name: x.name, table: r.table }];
  });
  const nameOf = (id: string) => (id === "current" ? "現状" : (plans.find((x) => x.id === id)?.name ?? ""));
  const cfB = cf.b !== "" && (cf.b === "current" || chosen.some((x) => x.id === cf.b)) ? cf.b : (chosen[0]?.id ?? "current");
  const cfA = cf.a === "current" || chosen.some((x) => x.id === cf.a) ? cf.a : "current";
  let cfModel: CashflowTableModel | null = null;
  const ra = results.get(cfA);
  const rb = results.get(cfB);
  if (ra !== undefined && rb !== undefined) {
    const years = displayYears(wh.request);
    const noEvidence = (m: CashflowTableModel): CashflowTableModel => ({ ...m, rows: m.rows.map((r) => (r.kind === "value" || r.kind === "total" ? { ...r, evidence: false } : r)) });
    cfModel =
      cf.mode === "diff"
        ? diffCashflowTable(wh.request, ra.table, rb.table, years, `差のキャッシュフロー表（${nameOf(cfB)} − ${nameOf(cfA)}）`)
        : noEvidence(cashflowTable(wh.request, (cf.mode === "a" ? ra : rb).table, years, `生涯キャッシュフロー表（${nameOf(cf.mode === "a" ? cfA : cfB)}）`));
  }
  const options = [{ id: "current", name: "現状" }, ...chosen.map((x) => ({ id: x.id, name: x.name }))];

  return (
    <div class="plans-tab" data-plans-tab>
      <p class="layout-note">配置は仮です（主画面と比較の見せ方を決めたら組み替えます）</p>
      <section class="card" aria-labelledby="h-plans">
        <div class="card-h">
          <h2 id="h-plans">案の一覧（{plans.length}件）</h2>
          <span class="aside">比べる案を {MAX_COMPARE}つまで選べます（{p.selected.length}/{MAX_COMPARE}）。保存はまだファイルにしません（アプリを閉じると消えます）</span>
        </div>
        {allTags.length > 0 ? (
          <div class="tag-filter" role="group" aria-label="印で絞る">
            <button type="button" class={tag === null ? "on" : ""} onClick={() => setTag(null)}>
              すべて
            </button>
            {allTags.map((t) => (
              <button type="button" key={t} class={tag === t ? "on" : ""} onClick={() => setTag(t)}>
                #{t}
              </button>
            ))}
          </div>
        ) : null}
        {plans.length === 0 ? (
          <p class="in-note">まだ案がありません。主画面で対策を動かして「案として保存」を押すと、ここに並びます。</p>
        ) : (
          <div class="plan-list-wrap">
            <table class="plan-list" data-plan-list>
              <thead>
                <tr>
                  <th scope="col">比べる</th>
                  <th scope="col">{sortBtn("name", "名前")}</th>
                  <th scope="col">{sortBtn("created", "作った日")}</th>
                  <th scope="col">{sortBtn("target", `${p.targetAge}歳時点の資産`)}</th>
                  <th scope="col">{sortBtn("depletion", "資産が尽きる年")}</th>
                  <th scope="col">{sortBtn("takeHome", "生涯の手取り")}</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => {
                  const m = metrics.get(x.id);
                  const review = changesOf(plans, x.id, wh, cat).filter((c) => c.state !== "ok").length;
                  const sel = p.selected.includes(x.id);
                  const baseName = x.base !== null ? plans.find((y) => y.id === x.base)?.name : null;
                  return (
                    <tr key={x.id} class={sel ? "sel" : ""}>
                      <td>
                        <input type="checkbox" checked={sel} disabled={!sel && p.selected.length >= MAX_COMPARE} onChange={() => toggle(x.id)} aria-label={`${x.name}を比べる`} data-compare-pick={x.id} />
                      </td>
                      <td class="pl-name">
                        {editing?.id === x.id ? (
                          <form
                            class="pl-edit"
                            onSubmit={(e) => {
                              e.preventDefault();
                              p.onEdit(renamePlan(wh, x.id, editing.name, editing.tags.split(/[,、\s]+/).filter((t) => t !== "")));
                              setEditing(null);
                            }}
                          >
                            <input type="text" value={editing.name} onInput={(e) => setEditing({ ...editing, name: (e.currentTarget as HTMLInputElement).value })} aria-label="案の名前" />
                            <input type="text" value={editing.tags} placeholder="印（読点で区切る）" onInput={(e) => setEditing({ ...editing, tags: (e.currentTarget as HTMLInputElement).value })} aria-label="印" />
                            <button type="submit" class="link-btn">
                              決める
                            </button>
                          </form>
                        ) : (
                          <>
                            <b>{x.name}</b>
                            {x.tags.map((t) => (
                              <span class="pl-tag" key={t}>
                                #{t}
                              </span>
                            ))}
                            {review > 0 ? <span class="pb-review sm">! 要確認 {review}</span> : null}
                            <span class="pl-sub">
                              変えたこと {changesOf(plans, x.id, wh, cat).length}件{baseName != null ? `・土台: ${baseName}` : ""}
                              {x.reflectedAt !== undefined ? "・現状に反映済み" : ""}
                            </span>
                          </>
                        )}
                      </td>
                      <td class="num">{dateText(x.createdAt)}</td>
                      <td class={`num${m !== undefined && m.target < 0 ? " neg" : ""}`}>{m === undefined ? "計算中…" : `${man(m.target)}万円`}</td>
                      <td class={m?.depletion != null ? "neg" : ""}>{m === undefined ? "" : m.depletion === null ? "尽きない" : `▲ ${m.depletion}年`}</td>
                      <td class="num">{m === undefined ? "" : `${man(m.takeHome)}万円`}</td>
                      <td class="pl-ops">
                        {confirm?.id === x.id ? (
                          <span class="pl-confirm">
                            {confirm.kind === "delete" ? "この案を外しますか（この案を土台にした案は、中身を引き継ぎます）" : "この案を入力（現状）に取り込みますか"}
                            <button
                              type="button"
                              class="link-btn danger"
                              onClick={() => {
                                if (confirm.kind === "delete") {
                                  p.onEdit(deletePlan(wh, x.id));
                                  p.onSelect((prev) => prev.filter((y) => y !== x.id));
                                } else p.onReflect(x.id);
                                setConfirm(null);
                              }}
                            >
                              {confirm.kind === "delete" ? "外す" : "取り込む"}
                            </button>
                            <button type="button" class="link-btn" onClick={() => setConfirm(null)}>
                              やめる
                            </button>
                          </span>
                        ) : (
                          <>
                            <button type="button" class="link-btn" onClick={() => p.onOpenPlan(x.id)}>
                              主画面で開く
                            </button>
                            <button type="button" class="link-btn" onClick={() => p.onBaseNew(x.id)}>
                              土台にして新しい案
                            </button>
                            <button type="button" class="link-btn" onClick={() => setEditing({ id: x.id, name: x.name, tags: x.tags.join("、") })}>
                              名前・印
                            </button>
                            <button type="button" class="link-btn" onClick={() => setConfirm({ id: x.id, kind: "reflect" })}>
                              現状に反映
                            </button>
                            <button type="button" class="link-btn danger" onClick={() => setConfirm({ id: x.id, kind: "delete" })}>
                              外す
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {error !== null ? <p class="fatal">計算できませんでした（{error}）</p> : null}
      {chosen.length > 0 ? (
        <section class="card compare-card" aria-label="案の比較" data-compare>
          <div class="card-h">
            <h2>案の比較（{chosen.length}案と現状）</h2>
            <span class="aside">{ready ? "金融資産の推移（年末）" : "計算しています…"}</span>
          </div>
          {comparedCurrent !== null ? <CompareChart model={compareChart(wh.request, comparedCurrent, comparedPlans)} /> : null}
          {comparedCurrent !== null && ready ? <CompareTable model={compareTable(wh.request, comparedCurrent, comparedPlans, p.targetAge)} /> : null}
        </section>
      ) : null}
      {chosen.length > 0 && cfModel !== null ? (
        <section class="cf-compare" aria-label="キャッシュフロー表の比較">
          <div class="cf-pick">
            <label>
              案A
              <select value={cfA} onChange={(e) => setCf({ ...cf, a: (e.currentTarget as HTMLSelectElement).value, b: cfB })}>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              案B
              <select value={cfB} onChange={(e) => setCf({ ...cf, a: cfA, b: (e.currentTarget as HTMLSelectElement).value })}>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <div class="level-switch" role="group" aria-label="表の見せ方">
              {(
                [
                  ["a", "案Aの表"],
                  ["b", "案Bの表"],
                  ["diff", "差（B−A）"],
                ] as const
              ).map(([k, l]) => (
                <button type="button" key={k} class={cf.mode === k ? "on" : ""} onClick={() => setCf({ a: cfA, b: cfB, mode: k })} data-cf-mode={k}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <CashflowTable model={cfModel} selectedYear={-1} onSelectYear={() => undefined} onEvidence={() => undefined} />
        </section>
      ) : null}
    </div>
  );
}
