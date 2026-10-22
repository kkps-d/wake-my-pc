(() => {
  "use strict";
  const knownStatuses = new Map();
  const announcement = () => document.getElementById("app-announcement");
  let dialogOpener = null;

  function openDialog(dialogId) {
    const dialog = document.getElementById(dialogId);
    if (!(dialog instanceof HTMLDialogElement)) return;
    if (!dialog.open) {
      dialogOpener = document.activeElement;
      dialog.showModal();
    }
    const focusable = dialog.querySelector('input[aria-invalid="true"]') || dialog.querySelector("input") || dialog.querySelector("button, [tabindex]:not([tabindex='-1'])");
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

  function syncList() {
    const search = document.getElementById("pc-search");
    const query = search ? search.value.trim().toLowerCase() : "";
    const rows = Array.from(document.querySelectorAll(".pc-row"));
    let matches = 0;
    rows.forEach(row => {
      row.hidden = !(row.dataset.searchText || "").toLowerCase().includes(query);
      if (!row.hidden) matches++;
    });
    const empty = document.querySelector("#pc-list .empty-state");
    const noResults = document.querySelector("#pc-list .search-empty");
    if (empty) empty.hidden = rows.length > 0;
    if (noResults) noResults.hidden = rows.length === 0 || matches > 0;
  }

  function syncStatuses(announceChanges) {
    const present = new Set();
    document.querySelectorAll("[data-status-state]").forEach(controls => {
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
    syncStatuses(false);
    syncList();
    document.addEventListener("click", event => {
      const element = event.target instanceof Element ? event.target.closest("[data-close-dialog]") : null;
      if (element) closeDialog(element.getAttribute("data-close-dialog"));
    });
    document.getElementById("pc-search")?.addEventListener("input", syncList);
    document.addEventListener("keydown", event => {
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && event.target instanceof Element && !event.target.matches("input, textarea, select, [contenteditable]") && !document.querySelector("dialog[open]")) {
        const search = document.getElementById("pc-search");
        if (search) { event.preventDefault(); search.focus(); }
      }
    });
    document.querySelectorAll("dialog.app-dialog").forEach(dialog => {
      dialog.addEventListener("click", event => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
      });
      dialog.addEventListener("close", () => {
        dialog.querySelector(".dialog-content")?.replaceChildren();
        if (dialogOpener instanceof HTMLElement && dialogOpener.isConnected) dialogOpener.focus();
        else document.getElementById("pc-search")?.focus();
        dialogOpener = null;
      });
    });
  });

  document.body.addEventListener("htmx:afterSwap", event => {
    const target = event.detail.target;
    if (!(target instanceof Element)) return;
    if (target.id === "add-dialog-content") openDialog("add-pc-dialog");
    if (target.id === "delete-dialog-content") openDialog("delete-pc-dialog");
    syncStatuses(true);
    syncList();
  });
  // An empty outerHTML delete has no replacement element to emit afterSwap.
  document.body.addEventListener("htmx:afterRequest", () => {
    syncStatuses(true);
    syncList();
  });
  document.body.addEventListener("closeAddDialog", () => closeDialog("add-pc-dialog"));
  document.body.addEventListener("closeDeleteDialog", () => closeDialog("delete-pc-dialog"));
  document.body.addEventListener("htmx:responseError", () => announce("The request could not be completed. Please try again."));
  document.body.addEventListener("htmx:sendError", () => announce("Cannot reach the server. Check that Wake My PC is running."));
})();
