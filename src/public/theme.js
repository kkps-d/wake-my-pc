(() => {
  "use strict";
  const root = document.documentElement;
  const storageKey = "wake-my-pc-theme";
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = "auto";
  try {
    const saved = localStorage.getItem(storageKey);
    if (["light", "dark", "auto"].includes(saved)) preference = saved;
  } catch (_) { /* Storage is optional. */ }

  function applyTheme() {
    const resolved = preference === "auto" ? (systemTheme.matches ? "dark" : "light") : preference;
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    const toggle = document.querySelector("[data-theme-toggle]");
    const icon = document.querySelector("[data-theme-icon]");
    const label = `Color theme: ${preference[0].toUpperCase()}${preference.slice(1)}`;
    if (toggle) {
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", label);
    }
    if (icon) icon.setAttribute("href", `/assets/icons/lucide.svg#${{ light: "sun", dark: "moon", auto: "monitor" }[preference]}`);
    document.querySelectorAll("[data-theme-option]").forEach(option => {
      option.setAttribute("aria-checked", String(option.dataset.themeOption === preference));
    });
  }

  // Resolve before the stylesheet loads to avoid flashing the wrong palette.
  applyTheme();
  systemTheme.addEventListener("change", () => { if (preference === "auto") applyTheme(); });
  window.addEventListener("storage", event => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = ["light", "dark", "auto"].includes(event.newValue) ? event.newValue : "auto";
    applyTheme();
  });

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme();
    const toggle = document.querySelector("[data-theme-toggle]");
    const menu = document.getElementById("theme-menu");
    if (!toggle || !menu) return;
    const options = Array.from(menu.querySelectorAll("[data-theme-option]"));
    function closeMenu(restoreFocus = false) {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      if (restoreFocus) toggle.focus();
    }
    function openMenu(index = options.findIndex(option => option.dataset.themeOption === preference)) {
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      options[Math.max(0, index)].focus();
    }
    toggle.addEventListener("click", () => menu.hidden ? openMenu() : closeMenu(true));
    toggle.addEventListener("keydown", event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openMenu(event.key === "ArrowDown" ? 0 : options.length - 1);
      }
    });
    options.forEach(option => option.addEventListener("click", () => {
      preference = option.dataset.themeOption;
      try { localStorage.setItem(storageKey, preference); } catch (_) { /* Storage is optional. */ }
      applyTheme();
      closeMenu(true);
    }));
    menu.addEventListener("keydown", event => {
      const index = options.indexOf(document.activeElement);
      const moves = { ArrowDown: (index + 1) % options.length, ArrowUp: (index + options.length - 1) % options.length, Home: 0, End: options.length - 1 };
      if (Object.hasOwn(moves, event.key)) {
        event.preventDefault();
        options[moves[event.key]].focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      } else if (event.key === "Tab") closeMenu(true);
    });
    document.addEventListener("click", event => {
      if (event.target instanceof Node && !toggle.contains(event.target) && !menu.contains(event.target)) closeMenu();
    });
    document.addEventListener("focusin", event => {
      if (event.target instanceof Node && !toggle.contains(event.target) && !menu.contains(event.target)) closeMenu();
    });
  });
})();
