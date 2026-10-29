/* Shell-only cache. Audio is never cached; EPUB bytes live in IndexedDB, not here. */
const CACHE = "library-read-shell-v14";
const DRIVE_MEDIA_PREFIX = "/drive-media/";
const DRIVE_TOKEN_MESSAGE = "libraryread.drive-token";
const DRIVE_UNAUTHORIZED_MESSAGE = "libraryread.drive-unauthorized";
/** In-memory only. The page posts the GIS access token; never cached. */
let driveToken = "";

self.addEventListener("message", (event) => {
  if (event.data?.type === DRIVE_TOKEN_MESSAGE) driveToken = event.data.token || "";
});

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=14",
  "./app.js?v=14",
  "./library.js?v=14",
  "./link.js?v=14",
  "./drive.js?v=14",
  "./search.js?v=14",
  "./epub.js?v=14",
  "./catalog.js?v=14",
  "./comfort.js?v=14",
  "./covers.js?v=14",
  "./shelf.js?v=14",
  "./content.js?v=14",
  "./reader.js?v=14",
  "./listen.js?v=14",
  "./store.js?v=14",
  "./manifest.webmanifest",
  "./icon.svg?v=14",
  "./apple-touch-icon.png?v=14",
  "./sample/demo.epub?v=14",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function driveFileIdFromPath(pathname) {
  const at = pathname.lastIndexOf(DRIVE_MEDIA_PREFIX);
  if (at < 0) return "";
  const raw = pathname.slice(at + DRIVE_MEDIA_PREFIX.length).split("/")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/* Keep Range / Authorization / Cache-Control: no-store in lockstep with
   planDriveMediaProxy + driveMediaProxyOutHeaders in drive.js. */
async function proxyDriveMedia(request, url) {
  const fileId = driveFileIdFromPath(url.pathname);
  if (!fileId) return new Response("Missing Drive file", { status: 400 });
  if (!driveToken) return new Response("Sign in with Google", { status: 401 });
  const headers = { Authorization: `Bearer ${driveToken}` };
  const range = request.headers.get("Range");
  if (range) headers.Range = range;
  const dest = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const res = await fetch(dest, { headers });
  if (res.status === 401) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: DRIVE_UNAUTHORIZED_MESSAGE });
  }
  const out = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = res.headers.get(name);
    if (value) out.set(name, value);
  }
  out.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.includes(DRIVE_MEDIA_PREFIX)) {
    event.respondWith(proxyDriveMedia(request, url));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML, past the HTTP cache (Pages sends max-age=600),
  // so a new release is picked up on the next launch.
  if (request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/")) {
    event.respondWith(
      fetch(request, { cache: "no-cache" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
