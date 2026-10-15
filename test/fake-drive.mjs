/**
 * In-memory Google Drive v3 + GIS stand-in for the fixture Library.
 * Used by node tests (as a fetch) and by Playwright (as a route handler).
 * Only answers what drive.js asks: files.list by name / parents, files.get
 * alt=media (with Range), about.
 */
import { readFileSync } from "node:fs";
import { fixtureEpubBytes, fixtureFiles } from "./library-fixture.mjs";
import { buildEpub } from "./epub-builder.mjs";

export const FIXTURE_TOKEN = "fixture-token";
export const FIXTURE_EMAIL = "reader@example.com";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SILENT_MP3 = readFileSync(new URL("./fixtures/silent-20s.mp3", import.meta.url));

/** Fake GIS client: initTokenClient → requestAccessToken → callback with the fixture token. */
export const FAKE_GIS_SCRIPT = `
window.__gisRequests = 0;
window.google = window.google || {};
window.google.accounts = {
  oauth2: {
    initTokenClient(opts) {
      return {
        requestAccessToken() {
          window.__gisRequests += 1;
          setTimeout(() => opts.callback({ access_token: ${JSON.stringify(FIXTURE_TOKEN)}, expires_in: 3600 }), 30);
        },
      };
    },
    revoke(token, done) { if (done) done(); },
  },
};`;

export function buildDriveTree(files = fixtureFiles()) {
  const nodes = new Map();
  const byPath = new Map();
  let n = 0;
  const folder = (path) => {
    if (byPath.has(path)) return byPath.get(path);
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const parent = parts.length > 1 ? folder(parts.slice(0, -1).join("/")) : null;
    const node = {
      id: parts.length === 1 ? "fx-root-library" : `fx-dir-${(n += 1)}`,
      name,
      mimeType: FOLDER_MIME,
      parents: parent ? [parent.id] : ["fx-my-drive"],
      ownedByMe: parts.length === 1,
    };
    nodes.set(node.id, node);
    byPath.set(path, node);
    return node;
  };
  files.forEach((f, i) => {
    const parts = f.path.split("/");
    const parent = folder(parts.slice(0, -1).join("/"));
    const name = parts[parts.length - 1];
    const id = `fx-file-${i}`;
    const mimeType =
      f.kind === "epub" ? "application/epub+zip" : f.kind === "audio" ? (/\.m4b$/i.test(name) ? "audio/mp4" : "audio/mpeg") : "application/octet-stream";
    nodes.set(id, { id, name, mimeType, parents: [parent.id], size: String(f.size), _file: f });
  });
  return { nodes, root: byPath.get("Library") };
}

function json(status, body) {
  return { status, contentType: "application/json", body: Buffer.from(JSON.stringify(body)), headers: {} };
}

function mediaBytes(node) {
  const f = node._file;
  if (f.kind === "epub") return Buffer.from(f.bookId ? fixtureEpubBytes(f.bookId) : buildEpub({ title: "skip", chapters: [{ title: "x" }] }));
  if (f.kind === "audio") return SILENT_MP3;
  return Buffer.from("");
}

/**
 * @param {string} url
 * @param {{ authorization?: string, range?: string }} headers
 * @param {{ nodes: Map<string, any>, root: any }} tree
 */
export function handleDriveRequest(url, headers = {}, tree = buildDriveTree(), log = null) {
  const u = new URL(url);
  log?.push(u.pathname + u.search);
  if ((headers.authorization || "") !== `Bearer ${FIXTURE_TOKEN}`) {
    return json(401, { error: { code: 401, message: "Invalid Credentials", status: "UNAUTHENTICATED" } });
  }
  if (u.pathname === "/drive/v3/about") {
    return json(200, { user: { emailAddress: FIXTURE_EMAIL, displayName: "Fixture Reader" } });
  }
  const media = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (media && u.searchParams.get("alt") === "media") {
    const node = tree.nodes.get(decodeURIComponent(media[1]));
    if (!node || node.mimeType === FOLDER_MIME) return json(404, { error: { code: 404, message: "File not found" } });
    const bytes = mediaBytes(node);
    const range = (headers.range || "").match(/bytes=(\d+)-(\d*)/);
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      return {
        status: 206,
        contentType: node.mimeType,
        body: bytes.subarray(start, end + 1),
        headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${bytes.length}` },
      };
    }
    return { status: 200, contentType: node.mimeType, body: bytes, headers: { "Accept-Ranges": "bytes" } };
  }
  if (u.pathname === "/drive/v3/files") {
    const q = u.searchParams.get("q") || "";
    const pageSize = Number(u.searchParams.get("pageSize")) || 1000;
    const offset = Number(u.searchParams.get("pageToken") || 0);
    let list = [];
    const byName = q.match(/name='([^']+)'/);
    const inParents = q.match(/'([^']+)' in parents/);
    if (byName) {
      if (!/sharedWithMe=true/.test(q)) list = [...tree.nodes.values()].filter((n) => n.name === byName[1] && n.mimeType === FOLDER_MIME);
    } else if (inParents) {
      list = [...tree.nodes.values()].filter((n) => n.parents?.[0] === inParents[1]);
    }
    const page = list.slice(offset, offset + pageSize).map(({ _file, ...rest }) => rest);
    const body = { files: page };
    if (offset + pageSize < list.length) body.nextPageToken = String(offset + pageSize);
    return json(200, body);
  }
  return json(404, { error: { code: 404, message: `fake drive has no ${u.pathname}` } });
}

/** A fetch() over the fake Drive, for node tests of drive.js. */
export function fakeDriveFetch(tree = buildDriveTree(), log = null) {
  return async (url, init = {}) => {
    const h = init.headers || {};
    const res = handleDriveRequest(String(url), { authorization: h.Authorization || h.authorization, range: h.Range || h.range }, tree, log);
    return new Response(res.body, { status: res.status, headers: { "content-type": res.contentType, ...res.headers } });
  };
}
