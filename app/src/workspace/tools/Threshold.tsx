// 結果のタブの「足りる境目」（0221）: 「計算のお知らせ」「ポイント」と同じ並びの小さな文字（「足りる境目 ▸」）で、ふだんは閉じている。
// 開くと、運用の利回り（5列）ごとに、金融資産が最後まで尽きない、いちばん早い働く最後の年齢（ご本人）の小さな表を出す。開いている間だけ計算する
// （閉じている間・閉じたら計算しない）。列を押すと、その利回りと年齢を対策に入れる（対策のスライダーを動かしたのと同じ。元に戻すで戻せる）。
// 探し方・判定は threshold.ts
import { useEffect, useState } from "preact/hooks";
import { revealChanged } from "../../presentation/revealAdded.ts";
import { answerText, currentText, findThresholds, rateLabel, usedText, type ColumnAnswer, type Judge, type ThresholdSetup } from "./threshold.ts";
import { sameRate } from "../input/units.ts";

export interface ThresholdProps {
  setup: ThresholdSetup;
  /** 判定（選んでいるプランの値に、ますの利回りと年齢を重ねて計算する）。選んでいるプラン・入力が変わったら新しい関数になる */
  judge: Judge;
  /** 選んでいるプランの名前（例: プランB） */
  plan: string;
  /** 対策に入れられないとき（現状・基準のプランを選んでいる）。表は出すが、列は押せない */
  locked: boolean;
  onUse: (rate: string, age: number) => void;
  initialOpen?: boolean;
  /** 計算を始めるまでの待ち（ミリ秒。スライダーを動かしている間に何度も計算し直さない。テストは 0） */
  delay?: number;
}

/** 答えの組（どの判定の答えか） */
interface Got {
  judge: Judge;
  answers: ColumnAnswer[];
}

export function Threshold({ setup, judge, plan, locked, onUse, initialOpen = false, delay = 300 }: ThresholdProps) {
  const [open, setOpen] = useState(initialOpen);
  const [got, setGot] = useState<Got | null>(null);
  const [used, setUsed] = useState<{ rate: string; age: number } | null>(null);
  const key = setup.rates.join(",") + `|${setup.min}-${setup.max}`;
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    const t = setTimeout(() => {
      void findThresholds(setup, judge, () => stopped).then((answers) => {
        if (!stopped && answers !== null) setGot({ judge, answers });
      });
    }, delay);
    return () => {
      stopped = true;
      clearTimeout(t);
    };
    // setup は描くたびに作り直すので、列と範囲の鍵で見る
  }, [open, judge, key, delay]);
  // 前の判定（別のプラン・直す前の入力）の答えは出さない
  const answers = got !== null && got.judge === judge && got.answers.length === setup.rates.length ? got.answers : null;
  return (
    <ThresholdView
      setup={setup}
      plan={plan}
      locked={locked}
      open={open}
      onToggle={() => setOpen(!open)}
      answers={answers}
      used={used}
      onUse={(e, a) => {
        if (locked || a.age === null) return;
        revealChanged(e.currentTarget as Element, '[data-lever-row="retireAge"], [data-added="inv:rate"]');
        onUse(a.rate, a.age);
        setUsed({ rate: a.rate, age: a.age });
      }}
    />
  );
}

export interface ThresholdViewProps {
  setup: ThresholdSetup;
  plan: string;
  locked: boolean;
  open: boolean;
  onToggle: () => void;
  /** 列の答え（計算している間は null） */
  answers: readonly ColumnAnswer[] | null;
  /** 押した列（その列の今の答えと同じときだけ「対策に入れました」を出す） */
  used: { rate: string; age: number } | null;
  onUse: (e: Event, a: ColumnAnswer) => void;
}

/** 見た目だけ（状態を持たない。テストで答えを渡して描く） */
export function ThresholdView({ setup, plan, locked, open, onToggle, answers, used, onUse: use }: ThresholdViewProps) {
  const isNow = (r: string) => sameRate(r, setup.rate);
  return (
    <div class={`threshold${open ? " open" : ""}`} data-threshold>
      <button type="button" class="quiet-toggle" aria-expanded={open} onClick={onToggle} data-threshold-open>
        足りる境目
        <span class="quiet-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div class="th-body" data-threshold-body aria-busy={answers === null}>
          <h3 class="th-h">最後まで足りる、いちばん早い「働く最後の年齢」</h3>
          <div class="th-scroll">
            <table class="th-table">
              <tbody>
                <tr>
                  <th scope="row">運用の利回り</th>
                  {setup.rates.map((r, i) => (
                    <th scope="col" key={r} class={isNow(r) ? "th-now" : undefined} onClick={(e) => answers?.[i] !== undefined && use(e, answers[i] as ColumnAnswer)} data-th-rate={r}>
                      {rateLabel(r)}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th scope="row">
                    働く最後の年齢<span class="th-who">（{setup.self}）</span>
                  </th>
                  {setup.rates.map((r, i) => {
                    const a = answers?.[i] ?? null;
                    const text = answerText(a, setup);
                    const can = a !== null && a.age !== null && !locked;
                    return (
                      <td key={r} class={`${isNow(r) ? "th-now" : ""}${a !== null && a.kind === "none" ? " th-short" : ""}`} data-th-cell={a?.kind ?? "pending"}>
                        {can ? (
                          <button type="button" class="th-use" onClick={(e) => use(e, a)} title={`利回り${rateLabel(r)}・${String(a.age)}歳まで働く、を対策に入れる`} data-th-use={r}>
                            {text}
                          </button>
                        ) : (
                          <span class="th-text">{text}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <p class="th-note" data-th-now>
            {currentText(setup, plan)}
          </p>
          {setup.spouse !== null ? (
            <p class="th-note" data-th-spouse>
              {setup.spouse}の働く年齢は今のままです（動かすのは{setup.self}だけ）
            </p>
          ) : null}
          <p class="th-note" aria-live="polite" data-th-hint>
            {locked
              ? "列を押して対策に入れるのは、動かせるプランを選んだときです"
              : used !== null && answers?.some((a) => a.age === used.age && sameRate(a.rate, used.rate)) === true
                ? usedText(used.rate, used.age)
                : "列を押すと、その利回りと年齢を対策に入れて比較できます（元に戻すで戻せます）"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
