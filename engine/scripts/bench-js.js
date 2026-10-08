// 速さの計測の JavaScript 側（Node（V8）と Bun（JavaScriptCore）で同じ手順を流す。scripts/bench.ts と scripts/jsc-bench.js から使う）。
// 0005 の追記（2回目の見直し）の目標:
//   1. スライダーを動かしている間: 世帯の入力（または案の前提）を1刻み動かし、今見ている案の1案×4想定を先出し（preview）で計算する1回の時間
//      （セッションに5案×4想定の枠を置き、20枠すべての要求を置き直してから、見ている案の4枠だけを計算する。画面の動きと同じ）
//   2. 手を離した後: ほかの4案×4想定（16枠）の先出しを計算する時間（正の計算は quickjs-ng 側で測る）
// 使い方: measure(engine, packsJson, data, repeat) → { 名前: { median, min } }
//   data = { requests: [20件], sliders: { 名前: [[20件]（刻み0）, [20件]（刻み1）, …] } }

const now = () => performance.now();

function stat(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return { median: Math.round(s[Math.floor(s.length / 2)] * 10) / 10, min: Math.round(s[0] * 10) / 10 };
}

function time(f, repeat, warm = 2) {
  for (let i = 0; i < warm; i++) f(i - warm);
  const xs = [];
  for (let i = 0; i < repeat; i++) {
    const t = now();
    f(i);
    xs.push(now() - t);
  }
  return stat(xs);
}

/** 枠の ID（案 p・想定 s） */
const slotId = (i) => `p${Math.floor(i / 4)}/s${i % 4}`;

export function measure(engine, packsJson, data, repeat) {
  const out = {};
  const reqJson = data.requests.map((r) => JSON.stringify(r));
  // 1件（正と同じ run の入口。温まった後）
  out.single = time(() => engine.run(reqJson[0], packsJson, "{}"), repeat);
  for (const [name, ticks] of Object.entries(data.sliders)) {
    const session = engine.createSession(packsJson);
    const setAll = (k) => {
      const reqs = ticks[k % ticks.length];
      const slots = {};
      reqs.forEach((r, i) => {
        slots[slotId(i)] = r;
      });
      session.set(JSON.stringify(slots));
    };
    // 始めに20枠すべてを計算しておく（画面を開いたとき）
    setAll(0);
    session.compute(undefined, '{"preview":true}');
    const visible = JSON.stringify([0, 1, 2, 3].map(slotId));
    let k = 0;
    const key = `slider${name[0].toUpperCase()}${name.slice(1)}`;
    out[key] = time(() => {
      k++;
      setAll(k);
      const r = session.compute(visible, '{"preview":true}');
      if (r.startsWith('{"error"')) throw new Error(r.slice(0, 200));
    }, repeat * 3, 3);
    if (name === "salary") {
      // 手を離した後: ほかの4案×4想定（古い印の付いた16枠）を先出しで計算し直す
      const others = JSON.stringify(Array.from({ length: 16 }, (_, i) => slotId(i + 4)));
      // afterRelease16 は手を離した後の16枠の計算だけの時間（見ている案の計算を除く）
      const xs = [];
      for (let i = 0; i < Math.max(3, Math.ceil(repeat / 2)); i++) {
        k++;
        setAll(k);
        session.compute(visible, '{"preview":true}');
        const t = now();
        session.compute(others, '{"preview":true}');
        xs.push(now() - t);
      }
      out.afterRelease16 = stat(xs);
    }
  }
  return out;
}
