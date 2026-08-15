const ALLOWED_ORIGINS = new Set([
  "https://setteandrea46-gif.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
]);

const IMAGEKIT_PUBLIC_KEY = "public_83x7dPWgWvHgdJ3owBsVgQgGPYA=";
const IMAGEKIT_URL_ENDPOINT = "https://ik.imagekit.io/c7xj7xyzht";
const SESSION_SECONDS = 60 * 60 * 24 * 365;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (!env.DB) throw new Error("Database DB non collegato");
      if (!env.IMAGEKIT_PRIVATE_KEY) throw new Error("Chiave ImageKit non configurata");
      await ensureSchema(env.DB);
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/" || path === "/api/health") {
        return json({ ok: true, service: "Polaroid API" }, 200, cors);
      }

      if (path === "/api/register" && request.method === "POST") {
        const body = await readJson(request);
        const username = clean(body.username, 60);
        const email = clean(body.email, 160).toLowerCase();
        const password = String(body.password || "");
        if (!username || !email.includes("@") || password.length < 4) {
          return json({ ok: false, message: "Inserisci nome, e-mail valida e una password di almeno 4 caratteri." }, 400, cors);
        }
        const existing = await env.DB.prepare("SELECT id FROM admins WHERE lower(email) = ? OR lower(username) = ? LIMIT 1")
          .bind(email, username.toLowerCase()).first();
        if (existing) return json({ ok: false, message: "E-mail o nome utente gia registrati. Usa Accedi oppure scegli dati diversi." }, 409, cors);
        const salt = randomBytes(16);
        const passwordHash = await hashPassword(password, salt);
        const inserted = await env.DB.prepare(
          "INSERT INTO admins (username, email, display_name, password_salt, password_hash) VALUES (?, ?, ?, ?, ?) RETURNING id"
        ).bind(username, email, username, bytesToBase64(salt), passwordHash).first();
        const token = await createSession(env.DB, inserted.id);
        return json({ ok: true, sessionToken: token }, 201, cors);
      }

      if (path === "/api/login" && request.method === "POST") {
        const body = await readJson(request);
        const identifier = clean(body.identifier || body.email, 160).toLowerCase();
        const password = String(body.password || "");
        const admin = await env.DB.prepare(
          "SELECT * FROM admins WHERE lower(email) = ? OR lower(username) = ? LIMIT 1"
        ).bind(identifier, identifier).first();
        if (!admin || !(await verifyPassword(password, admin.password_salt, admin.password_hash))) {
          return json({ ok: false, message: "E-mail, nome utente o password non corretti. Puoi riprovare subito." }, 401, cors);
        }
        const token = await createSession(env.DB, admin.id);
        return json({ ok: true, sessionToken: token }, 200, cors);
      }

      if (path === "/api/session" && request.method === "GET") {
        const admin = await requireAdmin(request, env.DB);
        return json({ ok: true, profile: publicProfile(admin) }, 200, cors);
      }

      if (path === "/api/logout" && request.method === "POST") {
        const token = bearerToken(request);
        if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
        return json({ ok: true }, 200, cors);
      }

      if (path === "/api/profile" && request.method === "GET") {
        const admin = await requireAdmin(request, env.DB);
        return json(publicProfile(admin), 200, cors);
      }

      if (path === "/api/profile" && request.method === "PUT") {
        const admin = await requireAdmin(request, env.DB);
        const body = await readJson(request);
        const username = clean(body.username, 60);
        const email = clean(body.email, 160).toLowerCase();
        const displayName = clean(body.displayName || username, 80);
        if (!username || !email.includes("@")) return json({ ok: false, message: "Controlla nome ed e-mail." }, 400, cors);
        if (body.password) {
          if (String(body.password).length < 4) return json({ ok: false, message: "La password deve avere almeno 4 caratteri." }, 400, cors);
          const salt = randomBytes(16);
          await env.DB.prepare(
            "UPDATE admins SET username = ?, email = ?, display_name = ?, password_salt = ?, password_hash = ? WHERE id = ?"
          ).bind(username, email, displayName, bytesToBase64(salt), await hashPassword(String(body.password), salt), admin.id).run();
        } else {
          await env.DB.prepare("UPDATE admins SET username = ?, email = ?, display_name = ? WHERE id = ?")
            .bind(username, email, displayName, admin.id).run();
        }
        const updatedAdmin = await env.DB.prepare("SELECT * FROM admins WHERE id = ?").bind(admin.id).first();
        return json({ ok: true, profile: publicProfile(updatedAdmin) }, 200, cors);
      }

      if (path === "/api/upload-auth" && request.method === "GET") {
        const admin = await requireAdmin(request, env.DB);
        const token = crypto.randomUUID();
        const expire = Math.floor(Date.now() / 1000) + 120;
        const signature = await hmacSha1(env.IMAGEKIT_PRIVATE_KEY, token + expire);
        return json({ token, expire, signature, publicKey: IMAGEKIT_PUBLIC_KEY, urlEndpoint: IMAGEKIT_URL_ENDPOINT, folderPrefix: `/Polaroid/account-${admin.id}` }, 200, cors);
      }

      if (path === "/api/photos" && request.method === "GET") {
        const eventCode = clean(url.searchParams.get("event"), 120);
        const admin = !eventCode ? await requireAdmin(request, env.DB) : null;
        const result = eventCode
          ? await env.DB.prepare("SELECT * FROM photos WHERE event_code = ? ORDER BY created_at DESC").bind(eventCode).all()
          : await env.DB.prepare("SELECT * FROM photos WHERE admin_id = ? ORDER BY event_date DESC, created_at DESC").bind(admin.id).all();
        return json((result.results || []).map(publicPhoto), 200, cors);
      }

      if (path === "/api/photos" && request.method === "POST") {
        const admin = await requireAdmin(request, env.DB);
        const body = await readJson(request);
        const photo = {
          id: clean(body.id, 80) || crypto.randomUUID(),
          eventName: clean(body.eventName, 120),
          eventDate: clean(body.eventDate, 20),
          eventCode: clean(body.eventCode, 120),
          fileId: clean(body.fileId, 180),
          filePath: clean(body.filePath, 500),
          originalUrl: clean(body.originalUrl, 1000),
          sizeBytes: Math.max(0, Number(body.sizeBytes || 0)),
        };
        if (!photo.eventName || !photo.eventDate || !photo.eventCode || !photo.fileId || !photo.filePath || !photo.originalUrl) {
          return json({ ok: false, message: "Dati della fotografia incompleti." }, 400, cors);
        }
        await env.DB.prepare(
          "INSERT INTO photos (id, event_name, event_date, event_code, file_id, file_path, original_url, size_bytes, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(photo.id, photo.eventName, photo.eventDate, photo.eventCode, photo.fileId, photo.filePath, photo.originalUrl, photo.sizeBytes, admin.id).run();
        return json({ ok: true, id: photo.id }, 201, cors);
      }

      const photoDelete = path.match(/^\/api\/photos\/([^/]+)$/);
      if (photoDelete && request.method === "DELETE") {
        const admin = await requireAdmin(request, env.DB);
        const id = decodeURIComponent(photoDelete[1]);
        const photo = await env.DB.prepare("SELECT * FROM photos WHERE id = ? AND admin_id = ?").bind(id, admin.id).first();
        if (photo) await deleteImageKitFile(photo.file_id, env.IMAGEKIT_PRIVATE_KEY);
        await env.DB.prepare("DELETE FROM photos WHERE id = ? AND admin_id = ?").bind(id, admin.id).run();
        return json({ ok: true }, 200, cors);
      }

      const download = path.match(/^\/api\/photos\/([^/]+)\/download$/);
      if (download && request.method === "POST") {
        const id = decodeURIComponent(download[1]);
        const body = await readJson(request);
        const eventCode = clean(body.eventCode, 120);
        const result = await env.DB.prepare(
          "UPDATE photos SET download_count = download_count + 1 WHERE id = ? AND event_code = ? RETURNING download_count"
        ).bind(id, eventCode).first();
        if (!result) return json({ ok: false }, 404, cors);
        return json({ ok: true, downloads: Number(result.download_count || 0) }, 200, cors);
      }

      const eventDelete = path.match(/^\/api\/events\/([^/]+)$/);
      if (eventDelete && request.method === "DELETE") {
        const admin = await requireAdmin(request, env.DB);
        const eventCode = decodeURIComponent(eventDelete[1]);
        const rows = await env.DB.prepare("SELECT file_id FROM photos WHERE event_code = ? AND admin_id = ?").bind(eventCode, admin.id).all();
        for (const row of rows.results || []) await deleteImageKitFile(row.file_id, env.IMAGEKIT_PRIVATE_KEY);
        await env.DB.prepare("DELETE FROM photos WHERE event_code = ? AND admin_id = ?").bind(eventCode, admin.id).run();
        return json({ ok: true }, 200, cors);
      }

      if (path === "/api/branding" && request.method === "GET") {
        const eventCode = clean(url.searchParams.get("event"), 120);
        let settings = null;
        if (eventCode) {
          settings = await env.DB.prepare("SELECT b.* FROM admin_branding b JOIN photos p ON p.admin_id = b.admin_id WHERE p.event_code = ? LIMIT 1")
            .bind(eventCode).first();
        } else if (bearerToken(request)) {
          const admin = await requireAdmin(request, env.DB);
          settings = await env.DB.prepare("SELECT * FROM admin_branding WHERE admin_id = ?").bind(admin.id).first();
        }
        return json(settings ? {
          companyName: settings.company_name,
          logoUrl: settings.logo_url || "",
          logoFileId: settings.logo_file_id || "",
        } : { companyName: "Polaroid", logoUrl: "", logoFileId: "" }, 200, cors);
      }

      if (path === "/api/branding" && request.method === "PUT") {
        const admin = await requireAdmin(request, env.DB);
        const body = await readJson(request);
        const previous = await env.DB.prepare("SELECT * FROM admin_branding WHERE admin_id = ?").bind(admin.id).first();
        await env.DB.prepare(
          "INSERT INTO admin_branding (admin_id, company_name, logo_url, logo_file_id) VALUES (?, ?, ?, ?) ON CONFLICT(admin_id) DO UPDATE SET company_name = excluded.company_name, logo_url = excluded.logo_url, logo_file_id = excluded.logo_file_id"
        ).bind(admin.id, clean(body.companyName, 60) || "Polaroid", clean(body.logoUrl, 1000), clean(body.logoFileId, 180)).run();
        if (previous?.logo_file_id && previous.logo_file_id !== body.logoFileId) {
          await deleteImageKitFile(previous.logo_file_id, env.IMAGEKIT_PRIVATE_KEY);
        }
        return json({ ok: true }, 200, cors);
      }

      if (path === "/api/visits" && request.method === "POST") {
        const body = await readJson(request);
        const eventCode = clean(body.eventCode, 120);
        const sessionId = clean(body.sessionId, 80) || crypto.randomUUID();
        const exists = await env.DB.prepare("SELECT id, admin_id FROM photos WHERE event_code = ? LIMIT 1").bind(eventCode).first();
        if (!exists) return json({ ok: false }, 404, cors);
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare("INSERT OR IGNORE INTO gallery_sessions (id, event_code, started_at, last_seen_at, admin_id) VALUES (?, ?, ?, ?, ?)")
          .bind(sessionId, eventCode, now, now, exists.admin_id).run();
        return json({ ok: true, sessionId }, 201, cors);
      }

      const heartbeat = path.match(/^\/api\/visits\/([^/]+)$/);
      if (heartbeat && request.method === "POST") {
        await env.DB.prepare("UPDATE gallery_sessions SET last_seen_at = ? WHERE id = ?")
          .bind(Math.floor(Date.now() / 1000), decodeURIComponent(heartbeat[1])).run();
        return json({ ok: true }, 200, cors);
      }

      if (path === "/api/stats" && request.method === "GET") {
        const admin = await requireAdmin(request, env.DB);
        const stats = await env.DB.prepare(
          "SELECT (SELECT COUNT(*) FROM gallery_sessions WHERE admin_id = ?) AS total_visitors, (SELECT COALESCE(SUM(download_count), 0) FROM photos WHERE admin_id = ?) AS total_downloads, (SELECT COALESCE(AVG(MAX(0, last_seen_at - started_at)), 0) FROM gallery_sessions WHERE admin_id = ?) AS average_session_seconds, (SELECT COALESCE(SUM(size_bytes), 0) FROM photos WHERE admin_id = ?) AS storage_bytes"
        ).bind(admin.id, admin.id, admin.id, admin.id).first();
        return json({
          totalVisitors: Number(stats.total_visitors || 0),
          totalDownloads: Number(stats.total_downloads || 0),
          averageSessionSeconds: Number(stats.average_session_seconds || 0),
          storageBytes: Number(stats.storage_bytes || 0),
        }, 200, cors);
      }

      return json({ ok: false, message: "Percorso non trovato" }, 404, cors);
    } catch (error) {
      const status = error?.status || 500;
      return json({ ok: false, message: status === 401 ? "Accesso scaduto. Accedi nuovamente." : String(error?.message || "Errore interno") }, status, cors);
    }
  },
};

async function ensureSchema(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()))"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, admin_id INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()))"),
    db.prepare("CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, event_name TEXT NOT NULL, event_date TEXT NOT NULL, event_code TEXT NOT NULL, file_id TEXT NOT NULL, file_path TEXT NOT NULL, original_url TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, download_count INTEGER NOT NULL DEFAULT 0, admin_id INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()))"),
    db.prepare("CREATE INDEX IF NOT EXISTS photos_event_code_idx ON photos(event_code)"),
    db.prepare("CREATE INDEX IF NOT EXISTS photos_admin_id_idx ON photos(admin_id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS admin_branding (admin_id INTEGER PRIMARY KEY, company_name TEXT NOT NULL DEFAULT 'Polaroid', logo_url TEXT, logo_file_id TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS gallery_sessions (id TEXT PRIMARY KEY, event_code TEXT NOT NULL, started_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, admin_id INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS gallery_sessions_event_idx ON gallery_sessions(event_code)"),
  ]);
}

async function requireAdmin(request, db) {
  const token = bearerToken(request);
  if (!token) throw httpError(401, "Accesso richiesto");
  const admin = await db.prepare(
    "SELECT a.* FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1"
  ).bind(await sha256(token), Math.floor(Date.now() / 1000)).first();
  if (!admin) throw httpError(401, "Sessione non valida");
  return admin;
}

async function createSession(db, adminId) {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(Math.floor(Date.now() / 1000)).run();
  const token = bytesToBase64Url(randomBytes(32));
  await db.prepare("INSERT INTO sessions (token_hash, expires_at, admin_id) VALUES (?, ?, ?)")
    .bind(await sha256(token), Math.floor(Date.now() / 1000) + SESSION_SECONDS, adminId).run();
  return token;
}

function publicProfile(admin) {
  return { username: admin.username, email: admin.email, displayName: admin.display_name };
}

function publicPhoto(row) {
  return {
    id: row.id,
    eventName: row.event_name,
    eventDate: row.event_date,
    eventCode: row.event_code,
    fileId: row.file_id,
    filePath: row.file_path,
    originalUrl: row.original_url,
    previewUrl: imageKitPreview(row.file_path),
    sizeBytes: Number(row.size_bytes || 0),
    downloads: Number(row.download_count || 0),
  };
}

function imageKitPreview(filePath) {
  const path = String(filePath || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${IMAGEKIT_URL_ENDPOINT}/tr:w-1200,q-70,f-auto/${path}`;
}

async function deleteImageKitFile(fileId, privateKey) {
  if (!fileId) return;
  const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Basic ${btoa(`${privateKey}:`)}` },
  });
  if (!response.ok && response.status !== 404) throw new Error("Impossibile eliminare il file da ImageKit");
}

async function hashPassword(password, saltBytes) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 100000 }, material, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function verifyPassword(password, saltBase64, expected) {
  const actual = await hashPassword(password, base64ToBytes(saltBase64));
  if (actual.length !== String(expected).length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ String(expected).charCodeAt(i);
  return mismatch === 0;
}

async function hmacSha1(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

async function sha256(value) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function bearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://setteandrea46-gif.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(value, status, cors) {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
