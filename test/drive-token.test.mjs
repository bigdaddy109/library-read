import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DRIVE_SEEN_KEY,
  DRIVE_SESSION_KEY,
  REAUTH_LABEL,
  beginInteractiveSignIn,
  clearAccessToken,
  clearDriveSession,
  freshAccessToken,
  saveDriveSession,
  tokenForChapterFetch,
  tokenForRead,
} from "../docs/drive.js?v=1";

function installGis(prompts, { failSilent = false, token = "gis-token", expiresIn = 3600 } = {}) {
  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient(opts) {
          return {
            requestAccessToken(arg) {
              const prompt = arg && Object.prototype.hasOwnProperty.call(arg, "prompt") ? arg.prompt : "(missing)";
              prompts.push(prompt);
              setTimeout(() => {
                if (prompt === "" && failSilent) {
                  opts.error_callback?.({ type: "interaction_required", message: "interaction_required" });
                  return;
                }
                if (prompt !== "" && prompt !== "consent") {
                  opts.error_callback?.({
                    type: "popup_failed_to_open",
                    message: "Failed to open popup window",
                  });
                  return;
                }
                opts.callback?.({ access_token: token, expires_in: expiresIn });
              }, 0);
            },
          };
        },
        revoke(_token, done) {
          if (done) done();
        },
      },
    },
  };
}

describe("Drive token during reading", { concurrency: false }, () => {
  /** @type {string[]} */
  let prompts;

  beforeEach(() => {
    prompts = [];
    clearAccessToken();
    try {
      localStorage.removeItem(DRIVE_SEEN_KEY);
      localStorage.removeItem(DRIVE_SESSION_KEY);
    } catch {
      /* no localStorage */
    }
    clearDriveSession();
    installGis(prompts);
  });

  afterEach(() => {
    clearAccessToken();
  });

  it("a chapter fetch after the gesture has ended reuses the token and does not call requestAccessToken", async () => {
    const token = await beginInteractiveSignIn();
    assert.deepEqual(prompts, ["consent"]);
    prompts.length = 0;
    const again = await tokenForChapterFetch();
    assert.equal(again, token);
    assert.equal(freshAccessToken(), token);
    assert.deepEqual(prompts, []);
  });

  it("an expired token is refreshed with prompt:'' and never a popup prompt", async () => {
    await beginInteractiveSignIn();
    prompts.length = 0;
    const next = await tokenForRead({ now: Date.now() + 4_000_000 });
    assert.equal(next, "gis-token");
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0], "");
    assert.ok(prompts.every((prompt) => prompt === ""));
  });

  it("when silent refresh fails, reading asks for 重新授權 and does not open a popup", async () => {
    clearAccessToken();
    installGis(prompts, { failSilent: true });
    await assert.rejects(tokenForChapterFetch(), (err) => {
      assert.equal(err.reauth, true);
      assert.equal(err.reauthLabel, REAUTH_LABEL);
      assert.equal(REAUTH_LABEL, "重新授權");
      return true;
    });
    assert.deepEqual(prompts, [""]);
    await assert.rejects(tokenForRead(), (err) => err.reauth === true);
    assert.deepEqual(prompts, ["", ""]);
  });

  it("a device that has signed in before tries prompt '' and falls back to consent", async () => {
    const data = new Map();
    globalThis.localStorage = {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      removeItem: (k) => data.delete(k),
    };
    localStorage.setItem(DRIVE_SEEN_KEY, "1");
    await beginInteractiveSignIn();
    assert.deepEqual(prompts, [""]);
    prompts.length = 0;
    clearAccessToken();
    installGis(prompts, { failSilent: true });
    await beginInteractiveSignIn();
    assert.deepEqual(prompts, ["", "consent"]);
    clearAccessToken();
    prompts.length = 0;
    localStorage.removeItem(DRIVE_SEEN_KEY);
    saveDriveSession({ folderId: "folder-1", folderName: "Library" });
    installGis(prompts);
    await beginInteractiveSignIn();
    assert.deepEqual(prompts, [""]);
  });
});
