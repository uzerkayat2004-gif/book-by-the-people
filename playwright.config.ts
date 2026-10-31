import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

function speak(name: string, lang: string, device: (typeof devices)[string], noIsolation = false) {
  return {
    name,
    testMatch: /voice-speak/,
    metadata: { lang, phone: device.isMobile === true, noIsolation },
    use: {
      ...device,
      permissions: ["microphone"],
      launchOptions: {
        args: [
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
          `--use-file-for-fake-audio-capture=${path.join(process.cwd(), "e2e", "fixtures", `${lang}.wav`)}`,
          // The test rewrites the page's headers; Chromium would then treat localhost calls as cross-network.
          ...(noIsolation ? ["--disable-features=LocalNetworkAccessChecks"] : []),
        ],
      },
    },
  };
}

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:43123",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:43123",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /voice-speak/ },
    // Speak, with a fake microphone playing a recorded sample into the real in-browser model.
    speak("speak-en", "en", devices["Desktop Chrome"]),
    speak("speak-hi", "hi", devices["Desktop Chrome"]),
    speak("speak-ja", "ja", devices["Desktop Chrome"]),
    speak("speak-phone", "en", devices["Pixel 7"]),
    // An iPhone-sized phone without cross-origin isolation (like Safari): one thread, no reloads.
    speak("speak-iphone-like", "en", { ...devices["iPhone 13"], defaultBrowserType: "chromium" }, true),
  ],
});
