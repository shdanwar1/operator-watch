/**
 * Coarse device identification for notification registration.
 *
 * This only *classifies* and *labels* a device; whether push actually works
 * is decided by capability detection in push-client.ts. Labels stay generic
 * ("iPhone · Safari") — no model numbers or other precise hardware details.
 */

export type DeviceType = "mobile" | "tablet" | "desktop";

export type DeviceInfo = {
  type: DeviceType;
  os: string;
  browser: string;
  label: string;
};

export function detectDevice(ua: string, maxTouchPoints = 0): DeviceInfo {
  const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const isIphone = /iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const androidPhone = isAndroid && /Mobile/.test(ua);

  let type: DeviceType = "desktop";
  let os = "Computer";
  let device = "Computer";
  if (isIphone) {
    type = "mobile";
    os = "iOS";
    device = "iPhone";
  } else if (isIpad) {
    type = "tablet";
    os = "iPadOS";
    device = "iPad";
  } else if (isAndroid) {
    type = androidPhone ? "mobile" : "tablet";
    os = "Android";
    device = androidPhone ? "Android" : "Android tablet";
  } else if (/Mobi|Windows Phone/i.test(ua)) {
    type = "mobile";
    os = "Mobile";
    device = "Phone";
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    os = "macOS";
    device = "Mac";
  } else if (/Windows/.test(ua)) {
    os = "Windows";
    device = "Windows PC";
  } else if (/CrOS/.test(ua)) {
    os = "ChromeOS";
    device = "Chromebook";
  } else if (/Linux/.test(ua)) {
    os = "Linux";
    device = "Linux PC";
  }

  let browser = "Browser";
  if (/SamsungBrowser/.test(ua)) browser = "Samsung Internet";
  else if (/EdgiOS|EdgA|Edg\//.test(ua)) browser = "Edge";
  else if (/FxiOS|Firefox\//.test(ua)) browser = "Firefox";
  else if (/OPR\/|OPiOS/.test(ua)) browser = "Opera";
  else if (/CriOS|Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  return { type, os, browser, label: `${device} · ${browser}` };
}

export function currentDevice(): DeviceInfo {
  if (typeof navigator === "undefined") return detectDevice("");
  return detectDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}
