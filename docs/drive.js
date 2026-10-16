/**
 * Google Drive library source for the web player and rice-paper homepage.
 * GIS token + Drive API v3 drive.readonly only. Client ID and Picker key
 * are public browser config (not secrets).
 */

import { AUDIO_EXT, COVER_EXT, EPUB_EXT, SKIP_FOLDERS, extOf } from "./library.js?v=6";

/** Public Web application OAuth Client ID. Not a secret. */
export const GOOGLE_OAUTH_CLIENT_ID =
  "827714015808-hp9o0gl26mbcs8mmipjfu2dtuvv9vdo3.apps.googleusercontent.com";

/**
 * Public browser API key for Google Picker (HTTP-referrer restricted to
 * https://bigdaddy109.github.io/*). Without it, the player still lists
 * folders named Library from Drive search.
 */
export const GOOGLE_PICKER_API_KEY = "AIzaSyBaeZWLYArw6iH-5-ietM3AyI8MNLOYui4";

export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const LIBRARY_FOLDER_NAME = "Library";
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const GIS_SRC = "https://accounts.google.com/gsi/client";
export const GAPI_SRC = "https://apis.google.com/js/api.js";
export const DRIVE_MEDIA_PREFIX = "/drive-media/";
export const DRIVE_TOKEN_MESSAGE = "libraryread.drive-token";
export const DRIVE_UNAUTHORIZED_MESSAGE = "libraryread.drive-unauthorized";
export const DRIVE_SESSION_KEY = "libraryread.drive.v1";
/** Drive files.list default. Tests pass a smaller pageSize to force nextPageToken. */
export const DRIVE_LIST_PAGE_SIZE = 1000;
export const DRIVE_MEDIA_PASSTHROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
];

export const DRIVE_ERROR_KIND = {
  abort: "abort",
  coop: "coop",
  config: "config",
  testUser: "test-user",
  expired: "expired",
  noLibrary: "no-library",
  accessDenied: "access-denied",
  reauth: "reauth",
  generic: "generic",
};

export const DRIVE_ERROR_MESSAGES = {
  testUser:
    "This Google account is not a test user for Library Read. While the OAuth consent screen is in Testing mode, only approved testers can sign in. Ask Jeff to add this account as a test user.",
  expired:
    "Google sign-in expired. Tap 用 Google 登入 again to keep streaming or reading from Drive.",
  noLibrary:
    "This Google account cannot see a folder named Library. Ask Jeff to share Library (Viewer) with this account, or Choose Library folder as a local fallback.",
  accessDenied:
    "Google did not grant Drive access. Sign in with an account Jeff shared Library with, or Choose Library folder as a local fallback.",
  cancelled: "Google sign-in was cancelled.",
  coop: "Chrome may log Cross-Origin-Opener-Policy window.closed while the GIS popup is open. That console warning is harmless and does not fail sign-in.",
  reauth: "Google Drive needs another tap on 重新授權. Reading will not open a popup by itself.",
};

/** Label for the only control that may open a GIS popup after the first sign-in. */
export const REAUTH_LABEL = "重新授權";
const TOKEN_SKEW_MS = 60_000;

const PLACEHOLDER_CLIENT = /YOUR_GOOGLE_OAUTH_CLIENT_ID/i;
const PLACEHOLDER_PICKER = /YOUR_GOOGLE_PICKER_API_KEY/i;

/** @type {string | null} */
let accessToken = null;
/** Epoch ms when `accessToken` stops being safe to send. 0 = none. */
let tokenExpiresAt = 0;
/** @type {Promise<string> | null} */
let gisInflight = null;
/** @type {((token: string) => void) | null} */
let rangeFetchImpl = null;

export function isPlaceholderClientId(id = GOOGLE_OAUTH_CLIENT_ID) {
  const value = String(id || "").trim();
  return !value || PLACEHOLDER_CLIENT.test(value) || !value.includes(".apps.googleusercontent.com");
}

export function isGoogleClientConfigured() {
  return !isPlaceholderClientId(GOOGLE_OAUTH_CLIENT_ID);
}

export function isPickerConfigured() {
  const key = String(GOOGLE_PICKER_API_KEY || "").trim();
  return !!key && !PLACEHOLDER_PICKER.test(key);
}

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  if (!token) {
    accessToken = null;
    tokenExpiresAt = 0;
    return null;
  }
  if (token === accessToken && tokenExpiresAt) return accessToken;
  accessToken = token;
  tokenExpiresAt = Date.now() + 3600 * 1000;
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
  tokenExpiresAt = 0;
  return null;
}

/** In-memory token that is still inside its lifetime. Never triggers GIS. */
export function freshAccessToken(now = Date.now()) {
  if (!accessToken || !tokenExpiresAt) return null;
  if (now >= tokenExpiresAt - TOKEN_SKEW_MS) return null;
  return accessToken;
}

function applyGisToken(resp) {
  const seconds = Number(resp?.expires_in);
  const ttl = Number.isFinite(seconds) && seconds > 0 ? seconds : 3600;
  accessToken = resp.access_token;
  tokenExpiresAt = Date.now() + ttl * 1000;
  return accessToken;
}

export function isDriveFile(file) {
  return !!file && typeof file.driveId === "string" && file.driveId.length > 0;
}

export function isDriveMediaPath(pathname) {
  return String(pathname || "").includes(DRIVE_MEDIA_PREFIX);
}

export function driveFileIdFromPath(pathname) {
  const path = String(pathname || "");
  const at = path.lastIndexOf(DRIVE_MEDIA_PREFIX);
  if (at < 0) return "";
  const raw = path.slice(at + DRIVE_MEDIA_PREFIX.length).split("/")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function driveMediaPath(fileId) {
  return `.${DRIVE_MEDIA_PREFIX}${encodeURIComponent(fileId)}`;
}

export function driveMediaUrl(fileId, base = globalThis.location?.href) {
  if (!base) return driveMediaPath(fileId);
  return new URL(driveMediaPath(fileId), base).href;
}

export function driveAltMediaUrl(fileId) {
  return `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
}

export function driveProxyHeaders(requestHeaders, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const range =
    requestHeaders?.get?.("Range") ||
    requestHeaders?.get?.("range") ||
    requestHeaders?.Range ||
    requestHeaders?.range;
  if (range) headers.Range = range;
  return headers;
}

/**
 * Chrome logs this when GIS polls `popup.closed` under COOP. The token still
 * arrives via postMessage — do not treat it as a sign-in failure.
 */
export function isGisCoopWindowClosedWarning(message) {
  const text = String(message || "");
  return /Cross-Origin-Opener-Policy/i.test(text) && /window\.closed/i.test(text);
}

function errorBlobText(input) {
  if (input == null) return "";
  if (typeof input === "string") return input;
  const nested = input.error && typeof input.error === "object" ? input.error : null;
  return [
    input.message,
    input.error,
    input.error_description,
    input.errorDescription,
    input.type,
    input.name,
    input.body,
    input.statusText,
    nested?.message,
    nested?.status,
    nested?.code,
    nested?.reason,
  ]
    .filter((part) => part != null && typeof part !== "object")
    .map(String)
    .join(" ");
}

function looksLikeTestUserDenial(text) {
  return (
    /test users?/i.test(text) ||
    /testing mode/i.test(text) ||
    /currently being tested/i.test(text) ||
    /only approved testers/i.test(text) ||
    /has not completed the Google verification process/i.test(text) ||
    /development mode/i.test(text)
  );
}

export function classifyDriveError(input) {
  const status = Number(input?.status ?? input?.error?.code ?? input?.error?.status) || 0;
  const nameIn = input?.name || "";
  const type = String(input?.type || "");
  const errorCode = String(
    typeof input?.error === "string" ? input.error : input?.error?.status || ""
  ).toLowerCase();
  const text = errorBlobText(input);

  if (isGisCoopWindowClosedWarning(text)) {
    return {
      kind: DRIVE_ERROR_KIND.coop,
      name: "DriveCoopWarning",
      message: DRIVE_ERROR_MESSAGES.coop,
      status,
      silent: true,
    };
  }

  if (nameIn === "DriveConfigError") {
    return {
      kind: DRIVE_ERROR_KIND.config,
      name: "DriveConfigError",
      message: input.message || "Google sign-in is not configured yet.",
      status,
    };
  }

  if (nameIn === "DriveLibraryMissing") {
    return {
      kind: DRIVE_ERROR_KIND.noLibrary,
      name: "DriveLibraryMissing",
      message: input.message || DRIVE_ERROR_MESSAGES.noLibrary,
      status,
    };
  }

  if (looksLikeTestUserDenial(text)) {
    return {
      kind: DRIVE_ERROR_KIND.testUser,
      name: "DriveTestUserError",
      message: DRIVE_ERROR_MESSAGES.testUser,
      status: status || 403,
    };
  }

  if (errorCode === "access_denied" || /access[_ ]denied/i.test(text)) {
    return {
      kind: DRIVE_ERROR_KIND.accessDenied,
      name: "DriveAccessDenied",
      message: DRIVE_ERROR_MESSAGES.accessDenied,
      status: status || 403,
    };
  }

  if (
    type === "popup_failed_to_open" ||
    errorCode === "popup_failed_to_open" ||
    /failed to open popup/i.test(text)
  ) {
    return {
      kind: DRIVE_ERROR_KIND.reauth,
      name: "DriveReauth",
      message: DRIVE_ERROR_MESSAGES.reauth,
      status,
      reauth: true,
    };
  }

  if (
    nameIn === "AbortError" ||
    type === "popup_closed" ||
    errorCode === "popup_closed" ||
    errorCode === "popup_closed_by_user" ||
    /popup_closed/i.test(text)
  ) {
    return {
      kind: DRIVE_ERROR_KIND.abort,
      name: "AbortError",
      message: DRIVE_ERROR_MESSAGES.cancelled,
      status,
      silent: true,
    };
  }

  if (status === 401 || nameIn === "DriveAuthError" || /expired|invalid[_ ]token|unauthorized/i.test(text)) {
    return {
      kind: DRIVE_ERROR_KIND.expired,
      name: "DriveAuthError",
      message: DRIVE_ERROR_MESSAGES.expired,
      status: status || 401,
    };
  }

  if (
    status === 403 ||
    /insufficientFilePermissions|cannot see a folder named Library|No folder named Library/i.test(text)
  ) {
    return {
      kind: DRIVE_ERROR_KIND.noLibrary,
      name: "DriveLibraryMissing",
      message: DRIVE_ERROR_MESSAGES.noLibrary,
      status: status || 403,
    };
  }

  return {
    kind: DRIVE_ERROR_KIND.generic,
    name: nameIn || "DriveError",
    message: (input && input.message) || text || "Could not open Google Drive.",
    status,
  };
}

export function driveErrorFrom(input) {
  const classified = classifyDriveError(input);
  const err = new Error(classified.message);
  err.name = classified.name;
  err.kind = classified.kind;
  err.status = classified.status;
  if (classified.silent) err.silent = true;
  if (classified.reauth || input?.reauth) err.reauth = true;
  if (input?.candidates) err.candidates = input.candidates;
  return err;
}

/** Ignore COOP `window.closed` noise; abort a real closed popup; classify the rest. */
export function gisAuthFailure(respOrErr) {
  if (!respOrErr) return driveErrorFrom({ message: DRIVE_ERROR_MESSAGES.cancelled, name: "AbortError" });
  if (isGisCoopWindowClosedWarning(respOrErr.message || respOrErr)) return null;
  return driveErrorFrom(respOrErr);
}

export function planDriveMediaProxy({ fileId, range, token } = {}) {
  if (!fileId) return { ok: false, status: 400, body: "Missing Drive file" };
  if (!token) return { ok: false, status: 401, body: "Sign in with Google" };
  return {
    ok: true,
    dest: driveAltMediaUrl(fileId),
    headers: driveProxyHeaders({ Range: range }, token),
  };
}

export function driveMediaProxyOutHeaders(upstreamHeaders) {
  const out = { "Cache-Control": "no-store" };
  for (const name of DRIVE_MEDIA_PASSTHROUGH_HEADERS) {
    const value =
      upstreamHeaders?.get?.(name) ||
      upstreamHeaders?.get?.(name.replace(/(^|-)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())) ||
      upstreamHeaders?.[name];
    if (value) {
      const pretty = name.replace(/(^|-)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
      out[pretty] = value;
    }
  }
  return out;
}

export function shouldNotifyDriveUnauthorized(status) {
  return Number(status) === 401;
}

export async function proxyDriveMediaRequest({ fileId, range, token } = {}, fetchImpl = fetch) {
  const plan = planDriveMediaProxy({ fileId, range, token });
  if (!plan.ok) {
    return {
      status: plan.status,
      body: plan.body,
      headers: { "Cache-Control": "no-store" },
      notifyUnauthorized: shouldNotifyDriveUnauthorized(plan.status),
    };
  }
  const res = await fetchImpl(plan.dest, { headers: plan.headers });
  return {
    status: res.status,
    statusText: res.statusText || "",
    headers: driveMediaProxyOutHeaders(res.headers || {}),
    body: res.body != null ? res.body : await res.arrayBuffer(),
    notifyUnauthorized: shouldNotifyDriveUnauthorized(res.status),
  };
}

export function libraryFolderQuery({ sharedWithMe = false } = {}) {
  const parts = [
    `name='${LIBRARY_FOLDER_NAME}'`,
    `mimeType='${DRIVE_FOLDER_MIME}'`,
    "trashed=false",
  ];
  if (sharedWithMe) parts.push("sharedWithMe=true");
  return parts.join(" and ");
}

export function childrenQuery(folderId) {
  return `'${folderId}' in parents and trashed=false`;
}

export function shouldSkipDriveName(name) {
  if (!name || name === "." || name === "..") return true;
  if (name.startsWith(".")) return true;
  if (name.startsWith("_")) return true;
  return SKIP_FOLDERS.has(name.toLowerCase());
}

export function resolveDriveItem(item) {
  if (!item) return null;
  if (item.mimeType === DRIVE_SHORTCUT_MIME && item.shortcutDetails?.targetId) {
    return {
      ...item,
      id: item.shortcutDetails.targetId,
      mimeType: item.shortcutDetails.targetMimeType || item.mimeType,
    };
  }
  return item;
}

export function walkPrefixForFolder(folder) {
  const name = String(folder?.name || LIBRARY_FOLDER_NAME).trim();
  return [name || LIBRARY_FOLDER_NAME];
}

export function uniqueDriveFolders(folders) {
  const seen = new Set();
  const out = [];
  for (const folder of folders || []) {
    if (!folder?.id || seen.has(folder.id)) continue;
    seen.add(folder.id);
    out.push(folder);
  }
  return out;
}

export function rankLibraryFolders(folders) {
  return uniqueDriveFolders(folders).sort((a, b) => {
    const ao = a.ownedByMe === true ? 0 : 1;
    const bo = b.ownedByMe === true ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

/** One hit → use it. Zero or many → caller shows Picker / a list. */
export function chooseSoleLibraryFolder(folders) {
  const ranked = rankLibraryFolders(folders);
  return ranked.length === 1 ? ranked[0] : null;
}

export function libraryFolderLabel(folder) {
  const name = folder?.name || LIBRARY_FOLDER_NAME;
  if (folder?.ownedByMe) return `${name} (your Drive)`;
  const owner =
    folder?.owners?.[0]?.displayName || folder?.owners?.[0]?.emailAddress || "";
  if (owner) return `${name} (shared by ${owner})`;
  if (folder?.shared) return `${name} (shared with you)`;
  return name;
}

export function mimeForDriveName(name) {
  const ext = extOf(name);
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a" || ext === "m4b" || ext === "aac") return "audio/mp4";
  if (ext === "epub") return "application/epub+zip";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

export function isLibraryMediaName(name) {
  const ext = extOf(name);
  return AUDIO_EXT.has(ext) || COVER_EXT.has(ext) || EPUB_EXT.has(ext);
}

function parentId(item) {
  return item?.parents?.[0] || null;
}

/**
 * Turn a flat Drive file list (id / name / parents) into {path, file} entries
 * that `buildLibrary` already understands. PDF is left for library.js to ignore.
 */
export function driveFilesToEntries(items, { rootId, rootName = LIBRARY_FOLDER_NAME } = {}) {
  const resolved = (items || []).map(resolveDriveItem).filter(Boolean);
  const byId = new Map(resolved.map((item) => [item.id, item]));
  const entries = [];

  const pathOf = (item) => {
    if (!item) return null;
    if (item.id === rootId) return [rootName];
    const seen = new Set();
    const parts = [];
    let cur = item;
    while (cur && cur.id !== rootId) {
      if (seen.has(cur.id)) return null;
      seen.add(cur.id);
      parts.unshift(cur.name);
      const pid = parentId(cur);
      if (!pid) return null;
      if (pid === rootId) {
        parts.unshift(rootName);
        return parts;
      }
      cur = byId.get(pid);
      if (!cur) return null;
    }
    return parts.length ? parts : null;
  };

  for (const item of resolved) {
    if (item.id === rootId) continue;
    if (item.mimeType === DRIVE_FOLDER_MIME) continue;
    if (shouldSkipDriveName(item.name) || !isLibraryMediaName(item.name)) continue;
    const parts = pathOf(item);
    if (!parts || parts.some(shouldSkipDriveName)) continue;
    const ext = extOf(item.name);
    const size = Number(item.size) || 0;
    if ((AUDIO_EXT.has(ext) || EPUB_EXT.has(ext)) && size === 0) continue;
    entries.push({
      path: parts.join("/"),
      file: makeDriveFile(item),
    });
  }
  return entries;
}

export function setDriveRangeFetch(fn) {
  rangeFetchImpl = typeof fn === "function" ? fn : null;
}

async function rangeBytes(fileId, start, end) {
  if (rangeFetchImpl) return rangeFetchImpl(fileId, start, end);
  const token = getAccessToken();
  if (!token) throw driveErrorFrom({ name: "DriveAuthError", status: 401 });
  const last = Math.max(start, end - 1);
  const headers = driveProxyHeaders({ Range: `bytes=${start}-${last}` }, token);
  const res = await fetch(driveAltMediaUrl(fileId), { headers });
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      body = "";
    }
    throw driveErrorFrom({
      status: res.status,
      name: res.status === 401 ? "DriveAuthError" : "",
      body,
    });
  }
  return res.arrayBuffer();
}

export function makeDriveFile(item) {
  const id = item?.id || item?.driveId;
  const name = item?.name || "file";
  const size = Number(item?.size) || 0;
  const type = item?.mimeType && !String(item.mimeType).startsWith("application/vnd.google-apps.")
    ? item.mimeType
    : mimeForDriveName(name);

  const file = {
    name,
    size,
    type,
    driveId: id,
    lastModified: Date.now(),
    slice(start = 0, end = size) {
      const from = Math.max(0, Number(start) || 0);
      const to = Math.min(size, end == null ? size : Number(end));
      const length = Math.max(0, to - from);
      return {
        size: length,
        async arrayBuffer() {
          if (!id || length <= 0) return new ArrayBuffer(0);
          return rangeBytes(id, from, to);
        },
        slice(innerStart = 0, innerEnd = length) {
          return file.slice(from + (Number(innerStart) || 0), from + (innerEnd == null ? length : Number(innerEnd)));
        },
      };
    },
    async arrayBuffer() {
      if (!id) return new ArrayBuffer(0);
      if (rangeFetchImpl) return rangeBytes(id, 0, size || 0);
      return downloadDriveBuffer(id);
    },
    async blob() {
      const buf = await file.arrayBuffer();
      return new Blob([buf], { type });
    },
  };
  return file;
}

export function loadDriveSession(store = defaultStore()) {
  try {
    const raw = store?.getItem?.(DRIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.folderId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDriveSession(session, store = defaultStore()) {
  if (!store?.setItem) return session;
  if (!session?.folderId) {
    try {
      store.removeItem?.(DRIVE_SESSION_KEY);
    } catch {
      /* private mode */
    }
    return null;
  }
  const record = {
    folderId: session.folderId,
    folderName: session.folderName || LIBRARY_FOLDER_NAME,
    email: session.email || "",
    updatedAt: new Date().toISOString(),
  };
  try {
    store.setItem(DRIVE_SESSION_KEY, JSON.stringify(record));
  } catch {
    /* quota / private mode */
  }
  return record;
}

export function clearDriveSession(store = defaultStore()) {
  try {
    store?.removeItem?.(DRIVE_SESSION_KEY);
  } catch {
    /* private mode */
  }
  return null;
}

function defaultStore() {
  try {
    if (typeof globalThis.localStorage !== "undefined") return globalThis.localStorage;
  } catch {
    /* private mode / Node */
  }
  return null;
}

function driveListUrl({ q, pageToken, fields, pageSize = DRIVE_LIST_PAGE_SIZE, corpora = "user" } = {}) {
  const url = new URL(`${DRIVE_API}/files`);
  const size = Math.min(1000, Math.max(1, Number(pageSize) || DRIVE_LIST_PAGE_SIZE));
  url.searchParams.set("q", q);
  url.searchParams.set("pageSize", String(size));
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("corpora", corpora || "user");
  url.searchParams.set(
    "fields",
    fields ||
      "nextPageToken,files(id,name,mimeType,size,parents,ownedByMe,shared,owners(displayName,emailAddress),shortcutDetails)"
  );
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url.toString();
}

export { driveListUrl };

async function readFetchBody(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function driveGetJson(url, token, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await readFetchBody(res);
  if (!res.ok) {
    let parsed = null;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      parsed = null;
    }
    throw driveErrorFrom({
      status: res.status,
      name: res.status === 401 ? "DriveAuthError" : "",
      message: parsed?.error?.message || body || res.statusText,
      error: typeof parsed?.error === "string" ? parsed.error : parsed?.error?.status || parsed?.error,
      error_description: parsed?.error?.message,
      body,
    });
  }
  return body ? JSON.parse(body) : {};
}

function isTransientDriveListError(err) {
  const status = Number(err?.status);
  if (status === 429 || status === 500 || status === 502 || status === 503) return true;
  const text = String(err?.message || err?.body || "");
  return status === 403 && /rateLimit|userRateLimit|backendError/i.test(text);
}

function waitDriveRetry(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function driveListAll(token, q, fetchImpl = fetch, { pageSize, corpora } = {}) {
  const files = [];
  let pageToken = "";
  do {
    let body = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        body = await driveGetJson(
          driveListUrl({ q, pageToken, pageSize, corpora }),
          token,
          fetchImpl
        );
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (!isTransientDriveListError(err) || attempt === 2) throw err;
        await waitDriveRetry(200 * (attempt + 1));
      }
    }
    if (!body && lastErr) throw lastErr;
    files.push(...(body.files || []));
    pageToken = body.nextPageToken || body.next_page_token || "";
  } while (pageToken);
  return files.map(resolveDriveItem).filter(Boolean);
}

export async function findLibraryFolders(token, fetchImpl = fetch) {
  const [mine, shared] = await Promise.all([
    driveListAll(token, libraryFolderQuery(), fetchImpl),
    driveListAll(token, libraryFolderQuery({ sharedWithMe: true }), fetchImpl),
  ]);
  return rankLibraryFolders([...mine, ...shared]);
}

export async function walkDriveFolder(
  folderId,
  token,
  { prefix, fetchImpl = fetch, pageSize, corpora = "allDrives" } = {}
) {
  const rootPrefix = prefix || [LIBRARY_FOLDER_NAME];
  /** @type {{ path: string, file: ReturnType<typeof makeDriveFile> }[]} */
  const entries = [];
  let skipped = 0;

  const walk = async (id, parts) => {
    const children = await driveListAll(token, childrenQuery(id), fetchImpl, {
      pageSize,
      corpora,
    });
    for (const raw of children) {
      const item = resolveDriveItem(raw);
      if (!item?.name || shouldSkipDriveName(item.name)) {
        skipped += 1;
        continue;
      }
      const next = [...parts, item.name];
      if (item.mimeType === DRIVE_FOLDER_MIME) {
        try {
          await walk(item.id, next);
        } catch {
          skipped += 1;
        }
        continue;
      }
      if (!isLibraryMediaName(item.name)) continue;
      const ext = extOf(item.name);
      const size = Number(item.size) || 0;
      if ((AUDIO_EXT.has(ext) || EPUB_EXT.has(ext)) && size === 0) {
        skipped += 1;
        continue;
      }
      entries.push({ path: next.join("/"), file: makeDriveFile(item) });
    }
  };

  await walk(folderId, rootPrefix);
  return { entries, skipped };
}

export async function downloadDriveBuffer(fileId, token = getAccessToken(), fetchImpl = fetch) {
  if (!token) throw driveErrorFrom({ name: "DriveAuthError", status: 401 });
  const res = await fetchImpl(driveAltMediaUrl(fileId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await readFetchBody(res);
    throw driveErrorFrom({
      status: res.status,
      name: res.status === 401 ? "DriveAuthError" : "",
      message: body || `Drive download failed (${res.status})`,
      body,
    });
  }
  return res.arrayBuffer();
}

export async function downloadDriveFile(file, token = getAccessToken(), fetchImpl = fetch) {
  const id = file?.driveId || file?.id;
  const name = file?.name || "file";
  const type = file?.type || mimeForDriveName(name);
  const buf = await downloadDriveBuffer(id, token, fetchImpl);
  if (typeof File === "function") {
    const disk = new File([buf], name, { type });
    disk.driveId = id;
    return disk;
  }
  return makeDriveFile({ id, name, size: buf.byteLength, mimeType: type });
}

export function attachDriveMedia(books, { base } = {}) {
  for (const book of books || []) {
    for (const ch of book.chapters || []) {
      if (isDriveFile(ch.file)) {
        ch.url = driveMediaUrl(ch.file.driveId, base);
        ch.driveId = ch.file.driveId;
      }
    }
    if (isDriveFile(book.ebook?.file)) {
      book.ebook.driveId = book.ebook.file.driveId;
    }
    if (isDriveFile(book.coverFile)) {
      book.coverDriveId = book.coverFile.driveId;
    }
    book.source = book.source || "drive";
  }
  return books;
}

export async function hydrateDriveCovers(books, token = getAccessToken(), fetchImpl = fetch) {
  await Promise.all(
    (books || []).map(async (book) => {
      if (!isDriveFile(book.coverFile) || book.coverFile.size > 8_000_000) return;
      try {
        book.coverFile = await downloadDriveFile(book.coverFile, token, fetchImpl);
      } catch {
        /* cover is optional */
      }
    })
  );
  return books;
}

export function snapshotDriveFields(file) {
  if (!isDriveFile(file)) return null;
  return { driveId: file.driveId, name: file.name, size: file.size, type: file.type };
}

export function restoreDriveFile(fields) {
  if (!fields?.driveId) return null;
  return makeDriveFile({
    id: fields.driveId,
    name: fields.name || "file",
    size: fields.size,
    mimeType: fields.type,
  });
}

function loadScript(src) {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Google scripts load in the browser."));
  }
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) {
    return existing.dataset.loaded === "1"
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
            once: true,
          });
        });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function requireClientId() {
  if (!isGoogleClientConfigured()) {
    const err = new Error(
      "Google sign-in is not configured yet. Paste a Web Client ID into GOOGLE_OAUTH_CLIENT_ID in docs/drive.js (see README)."
    );
    err.name = "DriveConfigError";
    throw err;
  }
}

export function tokenClientOptions(callback, errorCallback) {
  return {
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    scope: DRIVE_READONLY_SCOPE,
    callback,
    error_callback: errorCallback,
  };
}

function gisOauth() {
  return globalThis.google?.accounts?.oauth2 || null;
}

/** Load GIS so a later tap can call requestAccessToken in the same turn. Does not request a token. */
export function preloadGoogleIdentity() {
  if (gisOauth()?.initTokenClient) return Promise.resolve();
  return loadScript(GIS_SRC).then(() => {
    if (!gisOauth()?.initTokenClient) throw new Error("Google Identity Services did not load.");
  });
}

function markReauth(err) {
  const wrapped = err?.kind ? err : driveErrorFrom(err || { message: DRIVE_ERROR_MESSAGES.reauth });
  wrapped.reauth = true;
  wrapped.reauthLabel = REAUTH_LABEL;
  if (!wrapped.kind || wrapped.kind === DRIVE_ERROR_KIND.generic) {
    wrapped.kind = DRIVE_ERROR_KIND.reauth;
    wrapped.message = DRIVE_ERROR_MESSAGES.reauth;
  }
  return wrapped;
}

/**
 * Call GIS. `prompt` must already be chosen: "" is silent, "consent" opens a popup.
 * When the script is loaded this invokes requestAccessToken before returning.
 */
function requestGisToken(prompt) {
  requireClientId();
  const gis = gisOauth();
  if (!gis?.initTokenClient) {
    const err = new Error("Google 登入還沒準備好，請再按一次。");
    err.name = "DriveConfigError";
    throw err;
  }
  if (gisInflight) return gisInflight;
  const promptValue = prompt == null ? "consent" : String(prompt);
  gisInflight = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const client = gis.initTokenClient(
      tokenClientOptions(
        (resp) => {
          if (resp?.error || !resp?.access_token) {
            finish(reject, gisAuthFailure(resp) || driveErrorFrom(resp));
            return;
          }
          finish(resolve, applyGisToken(resp));
        },
        (err) => {
          // COOP can make GIS log window.closed; ignore that and keep waiting
          // for the token callback so we do not break the popup flow.
          const failure = gisAuthFailure(err);
          if (!failure) return;
          finish(reject, failure);
        }
      )
    );
    client.requestAccessToken({ prompt: promptValue });
  }).finally(() => {
    gisInflight = null;
  });
  return gisInflight;
}

/**
 * Explicit button only (用 Google 登入 / 重新授權 / 打開連結).
 * Must run inside the click, before any await, so Safari still has the gesture.
 */
export function beginInteractiveSignIn() {
  return requestGisToken("consent");
}

export async function signInWithGoogle({ prompt = "consent" } = {}) {
  requireClientId();
  if (!gisOauth()?.initTokenClient) await preloadGoogleIdentity();
  return requestGisToken(prompt);
}

export async function refreshGoogleToken() {
  requireClientId();
  if (!gisOauth()?.initTokenClient) await preloadGoogleIdentity();
  return requestGisToken("");
}

/**
 * Token for reading, page turns, and the next chapter fetch.
 * Reuses a fresh token, or refreshes with prompt:'' (no popup).
 * If silent refresh fails, rejects with err.reauth and does not open a popup.
 */
export function tokenForRead({ now = Date.now() } = {}) {
  const fresh = freshAccessToken(now);
  if (fresh) return Promise.resolve(fresh);
  const silent = () => requestGisToken("").catch((err) => Promise.reject(markReauth(err)));
  if (gisOauth()?.initTokenClient) return silent();
  return preloadGoogleIdentity().then(silent).catch((err) => Promise.reject(markReauth(err)));
}

/** Same policy as tokenForRead. Named for the post-gesture chapter/resource fetch. */
export function tokenForChapterFetch(opts) {
  return tokenForRead(opts);
}

export async function signOutGoogle() {
  const token = accessToken;
  clearAccessToken();
  try {
    const oauth2 = globalThis.google?.accounts?.oauth2;
    if (token && oauth2?.revoke) {
      await new Promise((resolve) => oauth2.revoke(token, resolve));
    }
  } catch {
    /* ignore revoke failures */
  }
  return null;
}

export async function publishDriveToken(token = getAccessToken()) {
  setAccessToken(token);
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return token;
  const message = { type: DRIVE_TOKEN_MESSAGE, token: token || "" };
  // `ready` never settles when no worker can register (private mode, blocked SW): never await it.
  navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage(message)).catch(() => {});
  navigator.serviceWorker.controller?.postMessage(message);
  return token;
}

export async function fetchDriveUser(token = getAccessToken(), fetchImpl = fetch) {
  if (!token) return "";
  try {
    const body = await driveGetJson(`${DRIVE_API}/about?fields=user`, token, fetchImpl);
    return body?.user?.emailAddress || body?.user?.displayName || "";
  } catch {
    return "";
  }
}

export async function openGooglePicker(token = getAccessToken()) {
  if (!isPickerConfigured()) {
    const err = new Error(
      "Google Picker needs GOOGLE_PICKER_API_KEY in docs/drive.js (see README)."
    );
    err.name = "DriveConfigError";
    throw err;
  }
  if (!token) throw new Error("Sign in with Google first.");
  await loadScript(GAPI_SRC);
  const gapi = globalThis.gapi;
  if (!gapi?.load) throw new Error("Google API script did not load.");
  await new Promise((resolve, reject) => {
    gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("Picker failed to load")) });
  });
  const pickerNs = globalThis.google?.picker;
  if (!pickerNs) throw new Error("Google Picker did not load.");

  return new Promise((resolve) => {
    const folders = (owned) => {
      const view = new pickerNs.DocsView(pickerNs.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes(DRIVE_FOLDER_MIME);
      if (owned === false) view.setOwnedByMe(false);
      return view;
    };
    const picker = new pickerNs.PickerBuilder()
      .addView(folders(true))
      .addView(folders(false))
      .enableFeature(pickerNs.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_PICKER_API_KEY)
      .setTitle("Pick the shared Library folder")
      .setCallback((data) => {
        if (data[pickerNs.Response.ACTION] === pickerNs.Action.PICKED) {
          const doc = data[pickerNs.Response.DOCUMENTS]?.[0];
          resolve(doc ? { id: doc[pickerNs.Document.ID], name: doc[pickerNs.Document.NAME] } : null);
          return;
        }
        if (data[pickerNs.Response.ACTION] === pickerNs.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

/**
 * Signed-in source sheet: Reload + Sign out, with local picks under Advanced.
 * Signed-out: Sign in + a local-folder text link. Picker is never a sheet action.
 */
export function sourceDialogActions({ signedIn } = {}) {
  if (signedIn) {
    return {
      google: false,
      reload: true,
      signout: true,
      localLink: false,
      local: true,
      files: true,
      picker: false,
      advanced: true,
    };
  }
  return {
    google: true,
    reload: false,
    signout: false,
    localLink: true,
    local: false,
    files: true,
    picker: false,
    advanced: true,
  };
}

/**
 * Resolve a Library folder, walk it, and return {path,file} entries for buildLibrary.
 * After sign-in the player auto-loads a folder named Library (My Drive + Shared with
 * me). `chooseFolder` is optional when several exist. `pickWithPicker` runs only
 * when no Library folder is found.
 */
export async function loadDriveEntries({
  token,
  folderId,
  folderName,
  chooseFolder,
  pickWithPicker,
  fetchImpl = fetch,
} = {}) {
  if (!token) throw new Error("Sign in with Google first.");
  let folder = folderId ? { id: folderId, name: folderName || LIBRARY_FOLDER_NAME } : null;
  if (!folder) {
    const found = await findLibraryFolders(token, fetchImpl);
    folder = chooseSoleLibraryFolder(found);
    if (!folder && found.length && typeof chooseFolder === "function") {
      folder = await chooseFolder(found);
    }
    if (!folder && found.length) {
      folder = rankLibraryFolders(found)[0] || null;
    }
    if (!folder && typeof pickWithPicker === "function") {
      folder = await pickWithPicker();
    }
    if (!folder && !found.length) {
      throw driveErrorFrom({
        name: "DriveLibraryMissing",
        message: DRIVE_ERROR_MESSAGES.noLibrary,
        candidates: found,
      });
    }
    if (!folder) {
      const err = new Error("Pick the shared Library folder to continue.");
      err.name = "AbortError";
      err.candidates = found;
      throw err;
    }
  }
  const walked = await walkDriveFolder(folder.id, token, {
    prefix: walkPrefixForFolder(folder),
    fetchImpl,
  });
  return { ...walked, folder };
}
