// 案の帯（提示層の部品）: 現状（A）と帯に並べた案（最大5つ）を小さなカードで並べる。
// カードは名前と「100歳まで足りる／○歳で不足」だけ（表示の設定で選んだ数字があれば、その下に足す）。
// 基準の案＝薄いグレーの実線の枠・灰の背景と「基準」の札、見ている案＝藍の太い枠と「表示中」の札、保存していない変更＝「変更あり」。色だけで区別しない。
// 比べ方が「全部の案を色分けで重ねる」のときだけ、各カードにグラフの線と同じ見た目の小さな印（色・線の種類・印の形）を付けて、どの線がどの案か分かるようにする。
// 受け取るのは PlanBandModel だけ（カードの鍵は A・B…の文字。物の ID は受け取らない。0016 の2）
import type { ComponentChildren } from "preact";
import type { PlanBandModel } from "./model.ts";
import { planStyles, PlanSwatch, type PlanStyle } from "./planLines.tsx";

export interface PlanBandProps {
  model: PlanBandModel;
  onSelect: (key: string) => void;
  onBase: (key: string) => void;
  onAdd: () => void;
  /** 帯の左の欄の下に置く操作（一覧・比較の表。作業の層が渡す） */
  links?: ComponentChildren;
  /** グラフの線と同じ見た目の印を各カードに付ける（全部の案を色分けで重ねる表示のときだけ） */
  lineMarks?: boolean;
}

export function PlanBand({ model, onSelect, onBase, onAdd, links, lineMarks = false }: PlanBandProps) {
  const many = model.cards.length > 4;
  const styles = lineMarks ? planStyles(model.cards) : null;
  return (
    <section class={`band${many ? " many" : ""}`} aria-label="案" data-band>
      <div class="band-head">
        <label>
          基準の案
          <select value={model.base} onChange={(e) => onBase((e.currentTarget as HTMLSelectElement).value)} aria-label="基準の案" data-base-select>
            {model.baseOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {links ?? null}
      </div>
      <div class="band-cards" role="group" aria-label="グラフに出す案">
        {model.cards.map((c) => (
          <button
            type="button"
            key={c.key}
            class={`plan${c.shown ? " is-sel" : ""}${c.base ? " is-base" : ""}`}
            aria-pressed={c.shown}
            title={`${c.letter}案 ${c.name}`}
            onClick={() => onSelect(c.key)}
            data-plan-card={c.key}
          >
            <span class="p-top">
              <span class="p-letter">{c.letter}</span>
              <span class="p-name">{c.name}</span>
              {c.base ? <span class="p-tag base">基準</span> : null}
              {c.shown ? <span class="p-tag show">表示中</span> : null}
            </span>
            <span class="p-nums">
              {c.shortAge === undefined ? (
                <span class="p-st wait">{c.status}</span>
              ) : c.shortAge === null ? (
                <span class="p-st ok">{c.status}</span>
              ) : (
                <span class="p-st ng">{c.status}</span>
              )}
              {c.modified ? <span class="p-mod">変更あり</span> : null}
              {styles !== null ? (
                <span class="p-mark" title={`グラフの線: ${(styles.get(c.key) as PlanStyle).dashName}`} data-plan-mark={c.key}>
                  <PlanSwatch style={styles.get(c.key) as PlanStyle} w={30} h={12} />
                </span>
              ) : null}
            </span>
            {c.metrics.map((m) => (
              <span class="p-amt" key={m.label}>
                <span class="p-k">{m.label}</span>
                <span class={`p-v num${m.neg ? " neg" : ""}`}>{m.text}</span>
              </span>
            ))}
            <span class="p-line" aria-hidden="true" />
          </button>
        ))}
      </div>
      <button type="button" class="plan-add" onClick={onAdd} data-plan-dup>
        <span>＋ この案を元に作る</span>
        <small>{model.addNote}</small>
      </button>
    </section>
  );
}
