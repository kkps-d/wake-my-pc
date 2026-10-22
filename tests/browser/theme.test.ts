import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../src/public/theme.js", import.meta.url), "utf8");

function loadTheme(saved: string | null, systemDark: boolean, storageUnavailable = false) {
  const dataset: Record<string, string> = {};
  const systemListeners: Array<() => void> = [];
  const windowListeners = new Map<string, (event: { key: string | null; newValue: string | null }) => void>();
  const media = {
    matches: systemDark,
    addEventListener: (_event: string, listener: () => void) => systemListeners.push(listener),
  };
  runInNewContext(source, {
    document: {
      documentElement: { dataset },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    window: {
      matchMedia: () => media,
      addEventListener: (event: string, listener: (value: { key: string | null; newValue: string | null }) => void) => windowListeners.set(event, listener),
    },
    localStorage: {
      getItem: () => {
        if (storageUnavailable) throw new Error("Storage disabled");
        return saved;
      },
    },
  });
  return {
    dataset,
    changeSystemTheme(dark: boolean) {
      media.matches = dark;
      systemListeners.forEach(listener => listener());
    },
    changeStoredTheme(value: string | null) {
      windowListeners.get("storage")?.({ key: "wake-my-pc-theme", newValue: value });
    },
  };
}

describe("browser color theme", () => {
  it.each([true, false])("defaults to Auto using the client setting (dark: %s)", dark => {
    const theme = loadTheme(null, dark);
    expect(theme.dataset.themePreference).toBe("auto");
    expect(theme.dataset.theme).toBe(dark ? "dark" : "light");
  });

  it("follows changes to the client setting in Auto mode", () => {
    const theme = loadTheme("auto", false);
    theme.changeSystemTheme(true);
    expect(theme.dataset.theme).toBe("dark");
    theme.changeSystemTheme(false);
    expect(theme.dataset.theme).toBe("light");
  });

  it.each(["light", "dark"])("keeps the explicit %s setting when the system changes", preference => {
    const theme = loadTheme(preference, preference !== "dark");
    theme.changeSystemTheme(true);
    theme.changeSystemTheme(false);
    expect(theme.dataset.theme).toBe(preference);
    expect(theme.dataset.themePreference).toBe(preference);
  });

  it("uses the client setting when storage is unavailable", () => {
    expect(loadTheme(null, true, true).dataset.theme).toBe("dark");
  });

  it("syncs preferences from other tabs and returns to Auto when cleared", () => {
    const theme = loadTheme("light", true);
    theme.changeStoredTheme("dark");
    expect(theme.dataset.themePreference).toBe("dark");
    theme.changeStoredTheme(null);
    expect(theme.dataset.themePreference).toBe("auto");
    expect(theme.dataset.theme).toBe("dark");
    theme.changeSystemTheme(false);
    expect(theme.dataset.theme).toBe("light");
  });
});
