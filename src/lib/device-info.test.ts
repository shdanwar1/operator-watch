import { describe, expect, it } from "vitest";
import { detectDevice } from "./device-info";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const ANDROID_TAB =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

describe("detectDevice", () => {
  it("iPhone Safari", () => expect(detectDevice(IPHONE)).toMatchObject({ type: "mobile", label: "iPhone · Safari" }));
  it("Android Chrome", () => expect(detectDevice(ANDROID)).toMatchObject({ type: "mobile", label: "Android · Chrome" }));
  it("Android tablet", () =>
    expect(detectDevice(ANDROID_TAB)).toMatchObject({ type: "tablet", label: "Android tablet · Chrome" }));
  it("desktop Mac", () => expect(detectDevice(MAC)).toMatchObject({ type: "desktop", label: "Mac · Chrome" }));
  it("iPad reporting a Mac UA", () =>
    expect(detectDevice(IPAD_DESKTOP_UA, 5)).toMatchObject({ type: "tablet", label: "iPad · Safari" }));
});
