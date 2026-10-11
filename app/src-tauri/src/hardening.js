// 起動時のスクリプト（0016 の1）。画面のどのスクリプトよりも先に動き、上書きできない形で次を止める。
// - 画面の保存機能（localStorage・sessionStorage・indexedDB・caches・document.cookie）: 使うと例外
// - WebAssembly（画面では使わない）
// - 新しいウィンドウ（window.open）と、target="_blank"・外のページへのリンク（外のページはアプリの中で開かない）
(() => {
  "use strict";
  const deny = (name) => {
    throw new DOMException(name + " は使えません", "SecurityError");
  };
  const lock = (target, name, descriptor) => {
    try {
      Object.defineProperty(target, name, { configurable: false, enumerable: false, ...descriptor });
    } catch (_) {
      // 既に変えられない形の場合は何もしない（CSP と incognito で二重に守る）
    }
  };
  for (const name of ["localStorage", "sessionStorage", "indexedDB", "caches"]) {
    lock(window, name, { get: () => deny(name) });
  }
  lock(Document.prototype, "cookie", { get: () => deny("cookie"), set: () => deny("cookie") });
  try {
    delete window.WebAssembly;
  } catch (_) {
    /* 消せないときは下で上書きする */
  }
  lock(window, "WebAssembly", { value: undefined, writable: false });
  lock(window, "open", { value: () => null, writable: false });
  document.addEventListener(
    "click",
    (event) => {
      const el = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (el === null) return;
      const href = el.getAttribute("href") || "";
      if (el.getAttribute("target") === "_blank" || /^[a-z][a-z0-9+.-]*:/i.test(href)) event.preventDefault();
    },
    true,
  );
})();
