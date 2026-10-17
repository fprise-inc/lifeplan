// 案の帯（作業の層）: 開いている案・変えたこと・要確認・保存（上書き・新しい案）・現状への反映（確認つき）・説明モードの入口。
// 配置は仮（主画面の配置を決めたら、置き場所を組み替える）
import { useState } from "preact/hooks";
import type { ChangeRow, Proposal } from "./plans.ts";

export interface PlanBarProps {
  plans: Proposal[];
  opened: string | null;
  modified: boolean;
  /** 開いている案（と作業中の変更）の変えたこと */
  changes: ChangeRow[];
  suggested: string;
  onOpen: (id: string | null) => void;
  onSaveNew: (name: string, tags: string[]) => void;
  onOverwrite: () => void;
  onReflect: () => void;
  onAck: (key: string) => void;
  onDrop: (key: string) => void;
  onExplain: () => void;
  onCompare: () => void;
  /** 開いた直後に保存の欄を開く（画面の確かめ用） */
  initialSave?: boolean;
}

type Mode = null | "save" | "reflect" | { switchTo: string | null };

export function PlanBar(p: PlanBarProps) {
  const [mode, setMode] = useState<Mode>(p.initialSave === true ? "save" : null);
  const [open, setOpen] = useState(p.initialSave === true);
  const [name, setName] = useState(p.suggested);
  const [tags, setTags] = useState("");
  const cur = p.plans.find((x) => x.id === p.opened);
  const review = p.changes.filter((c) => c.state !== "ok");
  const base = cur !== undefined ? cur.name : null;
  const startSave = () => {
    setName(p.suggested);
    setTags(cur?.tags.join("、") ?? "");
    setMode("save");
  };
  return (
    <section class="card plan-bar" aria-label="案" data-plan-bar>
      <div class="pb-row">
        <label class="pb-pick">
          <span class="pb-k">案</span>
          <select
            value={p.opened ?? ""}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value || null;
              if (p.modified) setMode({ switchTo: v });
              else p.onOpen(v);
              (e.currentTarget as HTMLSelectElement).value = p.opened ?? "";
            }}
            aria-label="開く案"
          >
            <option value="">{p.opened === null ? "作業中の案（保存していない）" : "作業中の案に切り替える"}</option>
            {p.plans.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          {p.modified && p.opened !== null ? <span class="pb-mod">変更あり（保存していない）</span> : null}
        </label>
        <button type="button" class="pb-changes" aria-expanded={open} onClick={() => setOpen(!open)} data-plan-changes>
          変えたこと <b>{p.changes.length}</b>件 {open ? "▴" : "▾"}
        </button>
        {review.length > 0 ? (
          <button type="button" class="pb-review" onClick={() => setOpen(true)} data-plan-review>
            ! 要確認 {review.length}
          </button>
        ) : null}
        <span class="pb-gap" />
        {p.opened !== null && p.modified ? (
          <button type="button" class="btn" onClick={p.onOverwrite} data-plan-overwrite>
            上書き保存
          </button>
        ) : null}
        <button type="button" class="btn primary" onClick={startSave} disabled={p.changes.length === 0 && p.opened === null} data-plan-save>
          {p.opened !== null ? "この案を土台に新しい案" : "案として保存"}
        </button>
        <button type="button" class="btn" onClick={() => setMode("reflect")} disabled={p.changes.length === 0} data-plan-reflect>
          この案を現状に反映…
        </button>
        <button type="button" class="btn" onClick={p.onCompare} data-plan-compare>
          案を比べる
        </button>
        <button type="button" class="btn" onClick={p.onExplain} data-explain-open>
          説明モード
        </button>
      </div>
      {open ? (
        <ul class="pb-list" aria-label="変えたこと">
          {p.changes.length === 0 ? <li class="in-note">現状から変えたことはありません（スライダーを動かすと、ここに並びます）</li> : null}
          {p.changes.map((c) => (
            <li key={c.key} class={c.state !== "ok" ? "review" : ""}>
              <span class="pb-l">{c.label}</span>
              <span class="pb-v">
                {c.from} → <b>{c.to}</b>
              </span>
              {c.inherited ? <span class="pb-tag">土台の案から</span> : null}
              {c.reviewNote !== null ? (
                <span class="pb-note">
                  <b>要確認:</b> {c.reviewNote}
                  {p.opened !== null ? (
                    <>
                      {c.state === "changed" ? (
                        <button type="button" class="link-btn" onClick={() => p.onAck(c.key)}>
                          確認した（このまま）
                        </button>
                      ) : null}
                      <button type="button" class="link-btn danger" onClick={() => p.onDrop(c.key)}>
                        この差分を外す
                      </button>
                    </>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {mode === "save" ? (
        <form
          class="pb-form"
          onSubmit={(e) => {
            e.preventDefault();
            p.onSaveNew(
              name,
              tags
                .split(/[,、\s]+/)
                .map((t) => t.trim())
                .filter((t) => t !== ""),
            );
            setMode(null);
          }}
          data-plan-save-form
        >
          <label>
            案の名前
            <input type="text" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label>
            印（まとめ。読点で区切る）
            <input type="text" value={tags} placeholder="例: 住宅、老後" onInput={(e) => setTags((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <span class="pb-base">土台: {base ?? "現状"}</span>
          <button type="submit" class="btn primary">
            保存
          </button>
          <button type="button" class="btn" onClick={() => setMode(null)}>
            やめる
          </button>
        </form>
      ) : null}
      {mode === "reflect" ? (
        <div class="pb-confirm" role="alertdialog" aria-label="現状に反映する" data-plan-reflect-confirm>
          <p>
            {cur !== undefined && !p.modified ? `「${cur.name}」` : "この案"}の変えたこと（{p.changes.length}件）を、入力（現状）に取り込みます。ほかの案は、現状が変わった項目が「要確認」になります。元に戻すときは、入力の画面で直してください。
          </p>
          <button type="button" class="btn danger" onClick={() => (setMode(null), p.onReflect())} data-plan-reflect-ok>
            現状に取り込む
          </button>
          <button type="button" class="btn" onClick={() => setMode(null)}>
            やめる
          </button>
        </div>
      ) : null}
      {mode !== null && typeof mode === "object" ? (
        <div class="pb-confirm" role="alertdialog" aria-label="保存していない変更">
          <p>保存していない変更があります。切り替えると、この変更は消えます。</p>
          <button type="button" class="btn danger" onClick={() => (p.onOpen(mode.switchTo), setMode(null))}>
            変更を捨てて切り替える
          </button>
          <button type="button" class="btn" onClick={() => setMode(null)}>
            やめる
          </button>
        </div>
      ) : null}
    </section>
  );
}
