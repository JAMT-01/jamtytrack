import { expect, it, vi } from "vitest";
import { createSessionCookie, createUnlockCookie, hasValidSession, hasPhotoUnlock } from "./auth.js";

const request = (cookie: string) => new Request("https://jamtytrack.example/", { headers: { cookie } });
it("issues the new cookie names and keeps sessions separate from photo unlocks", async () => {
  const session = await createSessionCookie("test-passphrase");
  const unlock = await createUnlockCookie("test-passphrase");
  expect(session).toMatch(/^jamtytrack_session=/);
  expect(unlock.cookie).toMatch(/^jamtytrack_photos=/);
  expect(await hasValidSession(request(session), "test-passphrase")).toBe(true);
  expect(await hasPhotoUnlock(request(unlock.cookie), "test-passphrase")).toBe(true);
  expect(await hasPhotoUnlock(request(session.replace("jamtytrack_session", "jamtytrack_photos")), "test-passphrase")).toBe(false);
  expect(await hasValidSession(request(session), "wrong-passphrase")).toBe(false);
  expect(await hasPhotoUnlock(request(unlock.cookie), "wrong-passphrase")).toBe(false);
});

it("rejects expired sessions and photo unlocks", async () => {
  vi.useFakeTimers();
  try {
    const session = await createSessionCookie("test-passphrase");
    const unlock = await createUnlockCookie("test-passphrase");
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);
    expect(await hasValidSession(request(session), "test-passphrase")).toBe(false);
    expect(await hasPhotoUnlock(request(unlock.cookie), "test-passphrase")).toBe(false);
  } finally { vi.useRealTimers(); }
});
