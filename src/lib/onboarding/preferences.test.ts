// @vitest-environment jsdom

/**
 * Tests for `useHasSeenWelcome` — same module-scope-cache constraint
 * `explorer-preferences.test.ts` documents: the store lives outside React,
 * so it survives between tests. Reset by writing localStorage and firing
 * the cross-tab `storage` event (a real code path, not a test-only
 * backdoor) rather than `vi.resetModules()`, which would hand the hook a
 * second copy of React and break `renderHook`.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useHasSeenWelcome } from "./preferences";

const STORAGE_KEY = "shore-dive:has-seen-welcome:v1";

function seedStorage(raw: string | null) {
  if (raw === null) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, raw);
  }
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  });
}

describe("useHasSeenWelcome", () => {
  beforeEach(() => {
    seedStorage(null);
  });

  it("defaults to false (not yet seen) when nothing is persisted", () => {
    const { result } = renderHook(() => useHasSeenWelcome());
    expect(result.current.hasSeenWelcome).toBe(false);
  });

  it("reports hydrated true after mount, in this real browser-like test environment", () => {
    const { result } = renderHook(() => useHasSeenWelcome());
    expect(result.current.isHydrated).toBe(true);
  });

  it("persists true once markWelcomeSeen is called, and a fresh mount reads it back", () => {
    const { result } = renderHook(() => useHasSeenWelcome());
    act(() => {
      result.current.markWelcomeSeen();
    });
    expect(result.current.hasSeenWelcome).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");

    const { result: second } = renderHook(() => useHasSeenWelcome());
    expect(second.current.hasSeenWelcome).toBe(true);
  });

  it("treats any non-'true' stored value as not-seen, rather than throwing", () => {
    seedStorage("garbage");
    const { result } = renderHook(() => useHasSeenWelcome());
    expect(result.current.hasSeenWelcome).toBe(false);
  });

  it("syncs across tabs via the storage event, same as explorer-preferences", () => {
    const { result } = renderHook(() => useHasSeenWelcome());
    expect(result.current.hasSeenWelcome).toBe(false);

    seedStorage("true");
    expect(result.current.hasSeenWelcome).toBe(true);
  });
});
