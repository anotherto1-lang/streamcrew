(() => {
  const KEY = "sc:theme";
  const media = window.matchMedia("(prefers-color-scheme: light)");

  function current() {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : media.matches ? "light" : "dark";
  }

  function apply(theme, save) {
    document.documentElement.dataset.theme = theme;
    if (save) localStorage.setItem(KEY, theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "light" ? "#f4f5f8" : "#0b0d12";
    const btn = document.getElementById("theme-btn");
    if (btn) btn.textContent = theme === "light" ? "🌙" : "☀️";
  }

  const btn = document.getElementById("theme-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      apply(current() === "dark" ? "light" : "dark", true);
    });
  }

  const onChange = () => {
    if (!localStorage.getItem(KEY)) apply(media.matches ? "light" : "dark", false);
  };
  if (media.addEventListener) media.addEventListener("change", onChange);
  else if (media.addListener) media.addListener(onChange);

  apply(current(), false);

  const local =
    location.protocol === "https:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";
  if ("serviceWorker" in navigator && local) {
    addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
})();
