import { describe, expect, it } from "vitest";
import { detectIosSafari } from "./use-pwa-install";

// Real device user-agent strings (captured from actual browsers), not
// guessed shapes — the whole point of testing this function is that UA
// sniffing is fragile and easy to get subtly wrong.
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
// iPadOS 13+ reports as "Macintosh" — only maxTouchPoints disambiguates it from a real Mac.
const IPADOS_DESKTOP_CLASS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1";
const MACOS_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

describe("detectIosSafari", () => {
  it("recognizes real iPhone Safari", () => {
    expect(detectIosSafari(IPHONE_SAFARI, 5)).toBe(true);
  });

  it("recognizes real iPad Safari (modern UA, reports as iPad)", () => {
    expect(detectIosSafari(IPAD_SAFARI, 5)).toBe(true);
  });

  it("recognizes iPadOS reporting as Macintosh when maxTouchPoints indicates a touchscreen", () => {
    expect(detectIosSafari(IPADOS_DESKTOP_CLASS_UA, 5)).toBe(true);
  });

  it("does NOT treat a real desktop Mac (0 touch points) as iOS", () => {
    expect(detectIosSafari(IPADOS_DESKTOP_CLASS_UA, 0)).toBe(false);
  });

  it("does NOT treat Chrome-on-iPhone (CriOS) as Safari — it can't fire beforeinstallprompt, but it isn't the iOS-Safari manual-instructions case either", () => {
    expect(detectIosSafari(IPHONE_CHROME, 5)).toBe(false);
  });

  it("does NOT treat real macOS Safari as iOS", () => {
    expect(detectIosSafari(MACOS_SAFARI, 0)).toBe(false);
  });

  it("does NOT treat Android Chrome as iOS Safari", () => {
    expect(detectIosSafari(ANDROID_CHROME, 5)).toBe(false);
  });

  it("does NOT treat Windows Chrome as iOS Safari", () => {
    expect(detectIosSafari(WINDOWS_CHROME, 0)).toBe(false);
  });
});
