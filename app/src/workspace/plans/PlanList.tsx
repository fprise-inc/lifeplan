// プランの一覧（作業の層。主画面の帯の左の「一覧から選ぶ」で、帯のすぐ下に開く。別の窓は出さない）。
// 保存できるプランの数に上限は無い。帯に並べるプランを最大5つ選ぶ。印で絞る・名前と印・現状に反映（確認つき）・外す（確認つき）。
// 保存はまだファイルにしない（アプリを閉じると消える）
import { useState } from "preact/hooks";
import type { WorkingHousehold } from "../input/household.ts";
import { MAX_BAND } from "./band.ts";
import type { Catalog } from "./items.ts";
import { changesOf, deletePlan, modernPlanName, planLabel, renamePlan } from "./plans.ts";

export interface PlanListProps {
  wh: WorkingHousehold;
  catalog: Catalog;
  letters: Map<string, { letter: string; name: string }>;
  band: string[];
  onBand: (id: string, on: boolean) => void;
  onEdit: (wh: WorkingHousehold) => void;
  onReflect: (id: string) => void;
  onClose: () => void;
}

const dateText = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m === null ? iso : `${Number(m[1])}/${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`;
};

export function PlanList(p: PlanListProps) {
  const { wh, catalog: cat } = p;
  const plans = wh.proposals;
  const [tag, setTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; tags: string } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "delete" | "reflect" } | null>(null);
  const allTags = [...new Set(plans.flatMap((x) => x.tags))];
  const rows = plans.filter((x) => tag === null || x.tags.includes(tag));
  const full = p.band.length >= MAX_BAND;
  return (
    <section class="card plan-list-card" aria-labelledby="h-plans" data-plan-list>
      <div class="card-h">
        <h2 id="h-plans">プランの一覧（{plans.length}件）</h2>
        <span class="aside">
          帯に並べるプランを {MAX_BAND}つまで選べます（{p.band.length}/{MAX_BAND}）。保存できるプランの数に上限はありません。保存はまだファイルにしません（アプリを閉じると消えます）
        </span>
        <button type="button" class="btn" onClick={p.onClose}>
          閉じる
        </button>
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
        <p class="in-note">まだプランがありません。帯の「＋ このプランを元に作る」か、対策を動かして「プランとして保存」を押すと、ここに並びます。</p>
      ) : (
        <div class="plan-list-wrap">
          <table class="plan-list">
            <thead>
              <tr>
                <th scope="col">帯に出す</th>
                <th scope="col">プラン</th>
                <th scope="col">作った日</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const ch = changesOf(plans, x.id, wh, cat);
                const review = ch.filter((c) => c.state !== "ok").length;
                const on = p.band.includes(x.id);
                const l = p.letters.get(x.id);
                const baseName = x.base !== null ? p.letters.get(x.base) : undefined;
                return (
                  <tr key={x.id} class={on ? "sel" : ""}>
                    <td>
                      <input type="checkbox" checked={on} disabled={!on && full} onChange={() => p.onBand(x.id, !on)} aria-label={`${modernPlanName(x.name)}を帯に出す`} data-band-pick={l?.letter ?? ""} />
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
                          <input type="text" value={editing.name} onInput={(e) => setEditing({ ...editing, name: (e.currentTarget as HTMLInputElement).value })} aria-label="プランの名前" />
                          <input type="text" value={editing.tags} placeholder="印（読点で区切る）" onInput={(e) => setEditing({ ...editing, tags: (e.currentTarget as HTMLInputElement).value })} aria-label="印" />
                          <button type="submit" class="link-btn">
                            決める
                          </button>
                        </form>
                      ) : (
                        <>
                          <span class="p-letter sm">{l?.letter ?? "?"}</span>
                          <b>{l?.name ?? x.name}</b>
                          {x.tags.map((t) => (
                            <span class="pl-tag" key={t}>
                              #{t}
                            </span>
                          ))}
                          {review > 0 ? <span class="pb-review sm">! 要確認 {review}</span> : null}
                          <span class="pl-sub">
                            変えたこと {ch.length}件{baseName !== undefined ? `・元のプラン: ${planLabel(baseName.letter)}` : ""}
                            {x.reflectedAt !== undefined ? "・現状に反映済み" : ""}
                          </span>
                        </>
                      )}
                    </td>
                    <td class="num">{dateText(x.createdAt)}</td>
                    <td class="pl-ops">
                      {confirm?.id === x.id ? (
                        <span class="pl-confirm">
                          {confirm.kind === "delete" ? "このプランを外しますか（このプランを元にしたプランは、中身を引き継ぎます）" : "このプランを入力（現状）に取り込みますか（ほかのプランは、現状が変わった項目が「要確認」になります）"}
                          <button
                            type="button"
                            class="link-btn danger"
                            onClick={() => {
                              if (confirm.kind === "delete") p.onEdit(deletePlan(wh, x.id));
                              else p.onReflect(x.id);
                              setConfirm(null);
                            }}
                          >
                            {confirm.kind === "delete" ? "外す" : "取り込む"}
                          </button>
                          <button type="button" class="link-btn" onClick={() => setConfirm(null)}>
                            キャンセル
                          </button>
                        </span>
                      ) : (
                        <>
                          <button type="button" class="link-btn" onClick={() => setEditing({ id: x.id, name: modernPlanName(x.name), tags: x.tags.join("、") })}>
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
  );
}
