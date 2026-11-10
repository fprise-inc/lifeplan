// ふだんは閉じておくまとまり（GroupDef.folded。0039 の追記 2026-11-10）: 使う世帯の少ない欄（税理士などが出した相続税の額など）を、
// 閉じている間は説明の文と「＋ 〇〇を入れる」のボタンだけにする。開け閉めは見せ方だけで、値は何も変えない（GroupOpen で覚える。保存しない）。
// どれかの欄に値が入っている世帯（startOpen）では初めから開き、閉じるリンクも出さない（入れた値を隠さない）
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { revealAdded } from "../../presentation/revealAdded.ts";
import type { GroupDef } from "./form.ts";
import type { GroupOpenState } from "./FieldViews.tsx";

export interface FoldState {
  /** 欄を出しているか */
  open: boolean;
  /** 「閉じる」のリンクを出すか（開いていて、値が入っていないとき） */
  closable: boolean;
  /** 開く・閉じる */
  toggle: () => void;
}

/**
 * まとまりの開け閉め（folded の無いまとまりは null）。値が入っていて初めから開いた物は、描いている間に値を消しても閉じない
 * （入れ直している途中で欄が消えないように。パネルを開き直すと、閉じた形に戻る）
 */
export function useFold(group: GroupDef, opened: GroupOpenState): FoldState | null {
  const startOpen = group.folded?.startOpen === true;
  const [kept, setKept] = useState(startOpen);
  if (group.folded === undefined) return null;
  const toggled = opened.isOpen(group.key);
  const open = startOpen || kept || toggled;
  return {
    open,
    closable: open && !startOpen,
    toggle: () => {
      if (!open) return opened.toggle(group.key);
      setKept(false);
      if (toggled) opened.toggle(group.key);
    },
  };
}

/** 説明の文を段落と箇条書きにする（「・」で始まる物は続けて1つの箇条書き。「?」の中の説明の helpBlocks と同じ決まり） */
function leadBlocks(lead: readonly string[]): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length === 0) return;
    out.push(
      <ul key={`l${String(out.length)}`} class="in-note in-folded-list">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>,
    );
    items = [];
  };
  for (const p of lead) {
    if (p.startsWith("・")) {
      items.push(p.slice(1));
      continue;
    }
    flush();
    out.push(
      <p key={`p${String(out.length)}`} class="in-note">
        {p}
      </p>,
    );
  }
  flush();
  return out;
}

/** 閉じているまとまり: 説明の文（1つが1段落）と、開くボタン。開いたら、出た欄を光らせて最初の欄に移る（「＋」で足した物と同じ） */
export function FoldedGroup({ group, onOpen, nested = false }: { group: GroupDef; onOpen: () => void; nested?: boolean }) {
  const f = group.folded;
  if (f === undefined) return null;
  return (
    <div class={`in-group in-folded${nested ? " in-sub" : ""}`} data-group={group.key} data-folded={group.key}>
      {group.title !== undefined ? (
        <div class="in-group-h">
          <h4>{group.title}</h4>
        </div>
      ) : null}
      {leadBlocks(f.lead)}
      <div class="in-actions">
        <button
          type="button"
          class="add-btn"
          aria-expanded={false}
          data-fold-open={group.key}
          onClick={(e) => {
            revealAdded(e.currentTarget, { items: ".fld" });
            onOpen();
          }}
        >
          {f.open}
        </button>
      </div>
    </div>
  );
}

/** 開いたまとまり（値が入っていないとき）の「▾ 閉じる」（「▸ 詳しく」の閉じると同じ形。押しても欄からフォーカスを外さない） */
export function FoldClose({ groupKey, label, onClose }: { groupKey: string; label: string; onClose: () => void }) {
  return (
    <div class="grp-more">
      <button type="button" class="link-btn grp-more-btn" aria-expanded={true} aria-label={`閉じる（${label}）`} onMouseDown={(e) => e.preventDefault()} onClick={onClose} data-fold-close={groupKey}>
        <span class="grp-more-mark" aria-hidden="true">
          ▾
        </span>
        <span class="grp-more-text">閉じる</span>
      </button>
    </div>
  );
}
