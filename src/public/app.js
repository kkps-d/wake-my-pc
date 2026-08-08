(() => {
  "use strict";

  const themeKey = "wake-my-pc-theme";
  const root = document.documentElement;
  const knownStatuses = new Map();
  const announcement = () => document.getElementById("app-announcement");

  function applyTheme(theme) {
    root.dataset.theme = theme;
    const toggle = document.querySelector("[data-theme-toggle]");
    const icon = document.querySelector("[data-theme-icon]");
    const isDark = theme === "dark";
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(isDark));
      toggle.setAttribute("aria-label", isDark ? "Use light color theme" : "Use dark color theme");
      toggle.setAttribute("title", isDark ? "Use light color theme" : "Use dark color theme");
    }
    if (icon) icon.textContent = isDark ? "☀" : "◐";
  }

  function storedTheme() {
    try { return localStorage.getItem(themeKey); } catch (_) { return null; }
  }

  function initialiseTheme() {
    const saved = storedTheme();
    applyTheme(saved === "dark" || saved === "light" ? saved : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  }

  function openDialog(dialogId) {
    const dialog = document.getElementById(dialogId);
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (!dialog.open) dialog.showModal();
    const focusable = dialog.querySelector("input, button, [tabindex]:not([tabindex='-1'])");
    if (focusable instanceof HTMLElement) focusable.focus();
  }

  function closeDialog(dialogId) {
    const dialog = document.getElementById(dialogId);
    if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
  }

  function announce(message) {
    const region = announcement();
    if (region) region.textContent = message;
  }

  function syncStatuses(announceChanges) {
    const present = new Set();
    document.querySelectorAll("[data-status-state]").forEach((controls) => {
      const id = controls.id;
      const state = controls.getAttribute("data-status-state");
      const name = controls.getAttribute("data-pc-name") || "PC";
      if (!id || !state) return;
      present.add(id);
      const previous = knownStatuses.get(id);
      knownStatuses.set(id, state);
      if (!announceChanges || !previous || previous === state) return;
      const messages = {
        waking: `${name}: Wake request sent.`,
        reachable: `${name} is reachable.`,
        unreachable: `${name} is unreachable.`,
        error: `${name}: Wake or status check failed.`,
      };
      if (messages[state]) announce(messages[state]);
    });
    for (const id of knownStatuses.keys()) {
      if (!present.has(id)) knownStatuses.delete(id);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initialiseTheme();
    syncStatuses(false);
    document.addEventListener("click", (event) => {
      const element = event.target instanceof Element ? event.target.closest("[data-theme-toggle], [data-close-dialog]") : null;
      if (!element) return;
      if (element.hasAttribute("data-theme-toggle")) {
        const next = root.dataset.theme === "dark" ? "light" : "dark";
        try { localStorage.setItem(themeKey, next); } catch (_) { /* storage is optional */ }
        applyTheme(next);
      }
      const dialogId = element.getAttribute("data-close-dialog");
      if (dialogId) closeDialog(dialogId);
    });

    document.querySelectorAll("dialog.app-dialog").forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
      dialog.addEventListener("close", () => {
        const content = dialog.querySelector(".dialog-content");
        if (content) content.replaceChildren();
      });
    });
  });

  document.body.addEventListener("htmx:afterSwap", (event) => {
    const target = event.detail.target;
    if (!(target instanceof Element)) return;
    if (target.id === "add-dialog-content") openDialog("add-pc-dialog");
    if (target.id === "delete-dialog-content") openDialog("delete-pc-dialog");
    syncStatuses(true);
  });

  document.body.addEventListener("openAddDialog", () => openDialog("add-pc-dialog"));
  document.body.addEventListener("closeAddDialog", () => closeDialog("add-pc-dialog"));
  document.body.addEventListener("openDeleteDialog", () => openDialog("delete-pc-dialog"));
  document.body.addEventListener("closeDeleteDialog", () => closeDialog("delete-pc-dialog"));
  document.body.addEventListener("htmx:responseError", () => announce("The request could not be completed. Please try again."));
  document.body.addEventListener("htmx:sendError", () => announce("Cannot reach the server. Check that Wake My PC is running."));
})();
