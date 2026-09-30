/**
 * Department of Geography Library Management System
 * Backend server - uses only Node.js built-in modules (no npm install required).
 * Created by Naveen Dissanayake
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

for (const d of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(d, { recursive: true });

/* ------------------------------------------------------------------ */
/* Data layer (JSON file DB). Schema mirrors database/schema.sql       */
/* ------------------------------------------------------------------ */

const DEFAULT_CATEGORIES = [
  "Human Geography",
  "Physical Geography",
  "GIS and RS",
  "Others",
  "English Club",
  "ERF Books",
];

function emptyDb() {
  return { users: [], books: [], categories: [], erf_members: [], sessions: [] };
}

let db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
} catch {
  db = emptyDb();
}
// Always make sure the six required categories exist
for (const name of DEFAULT_CATEGORIES) {
  if (!db.categories.some((c) => c.category_name === name)) {
    db.categories.push({ category_id: db.categories.length + 1, category_name: name });
  }
}
save();

function save() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

/* ------------------------------------------------------------------ */
/* Security helpers                                                    */
/* ------------------------------------------------------------------ */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split(":");
    if (algo !== "scrypt") return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(candidate, Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

function newSessionId() { return crypto.randomBytes(32).toString("hex"); }

const SESSION_TTL = 1000 * 60 * 60 * 8; // 8 hours

function createSession(userId) {
  const sid = newSessionId();
  db.sessions.push({ sid, user_id: userId, expires: Date.now() + SESSION_TTL });
  save();
  return sid;
}

function destroySession(sid) {
  db.sessions = db.sessions.filter((s) => s.sid !== sid);
  save();
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const sid = cookies.geo_session;
  if (!sid) return null;
  const sess = db.sessions.find((s) => s.sid === sid);
  if (!sess) return null;
  if (sess.expires < Date.now()) { destroySession(sid); return null; }
  const user = db.users.find((u) => u.user_id === sess.user_id);
  if (!user) return null;
  const isErf = db.erf_members.some(
    (m) => m.user_id === user.user_id && m.approval_status === "approved"
  );
  return { ...user, erf_member_status: isErf ? 1 : 0 };
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function send(res, status, body, headers = {}) {
  const isObj = typeof body === "object" && body !== null && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    "Content-Type": isObj ? "application/json; charset=utf-8" : headers["Content-Type"] || "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    ...headers,
  });
  res.end(data);
}

function jsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) { reject(new Error("Payload too large")); req.destroy(); return; }
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

// Simple in-memory rate limiter for login attempts
const loginAttempts = new Map();
function loginRateLimit(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, reset: now + 15 * 60 * 1000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 15 * 60 * 1000; }
  rec.count += 1;
  loginAttempts.set(ip, rec);
  return rec.count <= 10;
}

function requireAuth(req, res) {
  const user = getSessionUser(req);
  if (!user) { send(res, 401, { error: "Authentication required" }); return null; }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== "admin") { send(res, 403, { error: "Administrator access required" }); return null; }
  return user;
}

function canSeeErf(user) {
  return !!user && (user.role === "admin" || user.erf_member_status === 1);
}

function publicUser(u) {
  // Never expose password hashes
  return { user_id: u.user_id, username: u.username, role: u.role, erf_member_status: u.erf_member_status };
}

function publicBook(b) {
  const { ...rest } = b;
  return rest;
}

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

function toCsv(rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

/* ------------------------------------------------------------------ */
/* Cover image upload (data URL -> file)                               */
/* ------------------------------------------------------------------ */

const ALLOWED_IMG = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

function saveCoverImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 1.5 * 1024 * 1024) return null;
  const fname = "cover_" + crypto.randomBytes(8).toString("hex") + ALLOWED_IMG[m[1]];
  fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
  return "/uploads/" + fname;
}

/* ------------------------------------------------------------------ */
/* Static file serving                                                 */
/* ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".csv": "text/csv; charset=utf-8",
};

function serveStatic(res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "Forbidden" });
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { error: "Not found" });
    send(res, 200, data, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
  });
}

/* ------------------------------------------------------------------ */
/* API routes                                                          */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const p = u.pathname;
  const method = req.method;

  try {
    /* ---------------- Auth ---------------- */
    if (p === "/api/login" && method === "POST") {
      const ip = req.socket.remoteAddress || "unknown";
      if (!loginRateLimit(ip)) return send(res, 429, { error: "Too many attempts. Try again later." });
      const { username, password } = await jsonBody(req);
      const user = db.users.find((x) => x.username === String(username || ""));
      // Constant-shape response: verify against dummy hash when user missing
      const ok = user ? verifyPassword(String(password || ""), user.password_hash)
                      : (verifyPassword(String(password || ""), hashPassword("x")), false);
      if (!ok) return send(res, 401, { error: "Invalid username or password" });
      const sid = createSession(user.user_id);
      send(res, 200, { user: publicUser(user) }, {
        "Set-Cookie": `geo_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`,
      });
      return;
    }

    if (p === "/api/logout" && method === "POST") {
      const sid = parseCookies(req).geo_session;
      if (sid) destroySession(sid);
      send(res, 200, { ok: true }, { "Set-Cookie": "geo_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
      return;
    }

    if (p === "/api/me" && method === "GET") {
      const user = getSessionUser(req);
      if (!user) return send(res, 401, { error: "Not authenticated" });
      send(res, 200, { user: publicUser(user) });
      return;
    }

    /* ---------------- Categories (read: any logged-in user) ---------------- */
    if (p === "/api/categories" && method === "GET") {
      if (!requireAuth(req, res)) return;
      const user = getSessionUser(req);
      let cats = db.categories;
      // Hide the ERF category entirely from non-ERF members
      if (!canSeeErf(user)) cats = cats.filter((c) => c.category_name !== "ERF Books");
      send(res, 200, { categories: cats });
      return;
    }

    if (p === "/api/categories" && method === "POST") {
      if (!requireAdmin(req, res)) return;
      const { category_name } = await jsonBody(req);
      const name = String(category_name || "").trim();
      if (!name) return send(res, 400, { error: "Category name is required" });
      if (db.categories.some((c) => c.category_name.toLowerCase() === name.toLowerCase()))
        return send(res, 409, { error: "Category already exists" });
      db.categories.push({ category_id: (db.categories.at(-1)?.category_id || 0) + 1, category_name: name });
      save();
      send(res, 201, { categories: db.categories });
      return;
    }

    if (p.startsWith("/api/categories/") && method === "DELETE") {
      if (!requireAdmin(req, res)) return;
      const id = parseInt(p.split("/")[3], 10);
      const cat = db.categories.find((c) => c.category_id === id);
      if (!cat) return send(res, 404, { error: "Category not found" });
      if (db.books.some((b) => b.category === cat.category_name))
        return send(res, 400, { error: "Category has books and cannot be deleted" });
      db.categories = db.categories.filter((c) => c.category_id !== id);
      save();
      send(res, 200, { categories: db.categories });
      return;
    }

    /* ---------------- Books ---------------- */
    if (p === "/api/books" && method === "GET") {
      const user = requireAuth(req, res);
      if (!user) return;
      const search = (u.searchParams.get("search") || "").toLowerCase().trim();
      const category = u.searchParams.get("category") || "";
      let books = db.books;
      if (!canSeeErf(user)) books = books.filter((b) => b.category !== "ERF Books");
      if (category) books = books.filter((b) => b.category === category);
      if (search) books = books.filter((b) =>
        [b.title, b.author, b.isbn, b.publisher].some((f) => String(f || "").toLowerCase().includes(search)));
      send(res, 200, { books: books.map(publicBook), total: books.length });
      return;
    }

    if (p === "/api/books" && method === "POST") {
      if (!requireAdmin(req, res)) return;
      const body = await jsonBody(req);
      const errs = validateBook(body);
      if (errs.length) return send(res, 400, { error: errs.join("; ") });
      let image = "";
      if (body.image_data) image = saveCoverImage(body.image_data) || "";
      const book = {
        book_id: (db.books.at(-1)?.book_id || 0) + 1,
        title: body.title.trim(), author: body.author.trim(),
        publisher: String(body.publisher || "").trim(),
        year: parseInt(body.year, 10) || null,
        isbn: String(body.isbn || "").trim(),
        category: body.category, language: String(body.language || "").trim(),
        copies: Math.max(0, parseInt(body.copies, 10) || 0),
        shelf_location: String(body.shelf_location || "").trim(),
        description: String(body.description || "").trim(),
        image,
        created_at: new Date().toISOString(),
      };
      db.books.push(book);
      save();
      send(res, 201, { book });
      return;
    }

    if (p.startsWith("/api/books/") && method === "GET") {
      const user = requireAuth(req, res);
      if (!user) return;
      const id = parseInt(p.split("/")[3], 10);
      const book = db.books.find((b) => b.book_id === id);
      if (!book) return send(res, 404, { error: "Book not found" });
      if (book.category === "ERF Books" && !canSeeErf(user))
        return send(res, 403, { error: "ERF membership required to view this book" });
      send(res, 200, { book: publicBook(book) });
      return;
    }

    if (p.startsWith("/api/books/") && method === "PUT") {
      if (!requireAdmin(req, res)) return;
      const id = parseInt(p.split("/")[3], 10);
      const book = db.books.find((b) => b.book_id === id);
      if (!book) return send(res, 404, { error: "Book not found" });
      const body = await jsonBody(req);
      const errs = validateBook(body);
      if (errs.length) return send(res, 400, { error: errs.join("; ") });
      book.title = body.title.trim(); book.author = body.author.trim();
      book.publisher = String(body.publisher || "").trim();
      book.year = parseInt(body.year, 10) || null;
      book.isbn = String(body.isbn || "").trim();
      book.category = body.category;
      book.language = String(body.language || "").trim();
      book.copies = Math.max(0, parseInt(body.copies, 10) || 0);
      book.shelf_location = String(body.shelf_location || "").trim();
      book.description = String(body.description || "").trim();
      if (body.image_data) { const img = saveCoverImage(body.image_data); if (img) book.image = img; }
      else if (body.image !== undefined && !body.image_data) book.image = String(body.image || "");
      save();
      send(res, 200, { book });
      return;
    }

    if (p.startsWith("/api/books/") && method === "DELETE") {
      if (!requireAdmin(req, res)) return;
      const id = parseInt(p.split("/")[3], 10);
      if (!db.books.some((b) => b.book_id === id)) return send(res, 404, { error: "Book not found" });
      db.books = db.books.filter((b) => b.book_id !== id);
      save();
      send(res, 200, { ok: true });
      return;
    }

    /* ---------------- Statistics (home page) ---------------- */
    if (p === "/api/stats" && method === "GET") {
      const user = getSessionUser(req); // optional auth: guests see public stats without ERF
      const visible = canSeeErf(user) ? db.books : db.books.filter((b) => b.category !== "ERF Books");
      const byCategory = {};
      for (const b of visible) byCategory[b.category] = (byCategory[b.category] || 0) + 1;
      const totalCopies = visible.reduce((s, b) => s + (b.copies || 0), 0);
      send(res, 200, {
        total_books: visible.length,
        total_copies: totalCopies,
        categories: db.categories.filter((c) => canSeeErf(user) || c.category_name !== "ERF Books"),
        by_category: byCategory,
      });
      return;
    }

    /* ---------------- Admin: ERF member management ---------------- */
    if (p === "/api/admin/users" && method === "GET") {
      if (!requireAdmin(req, res)) return;
      const users = db.users.map((x) => ({
        user_id: x.user_id, username: x.username, role: x.role,
        erf_member_status: db.erf_members.some((m) => m.user_id === x.user_id && m.approval_status === "approved") ? 1 : 0,
      }));
      send(res, 200, { users });
      return;
    }

    if (p.startsWith("/api/admin/users/") && p.endsWith("/erf") && method === "POST") {
      if (!requireAdmin(req, res)) return;
      const id = parseInt(p.split("/")[4], 10);
      const target = db.users.find((x) => x.user_id === id);
      if (!target) return send(res, 404, { error: "User not found" });
      const { status } = await jsonBody(req); // "approved" | "revoked"
      if (status === "approved") {
        if (!db.erf_members.some((m) => m.user_id === id))
          db.erf_members.push({ member_id: (db.erf_members.at(-1)?.member_id || 0) + 1, user_id: id, approval_status: "approved" });
        else db.erf_members.forEach((m) => { if (m.user_id === id) m.approval_status = "approved"; });
      } else if (status === "revoked") {
        db.erf_members = db.erf_members.filter((m) => m.user_id !== id);
      } else {
        return send(res, 400, { error: "Invalid status" });
      }
      save();
      send(res, 200, { ok: true });
      return;
    }

    /* ---------------- CSV export (admin only) ---------------- */
    if (p === "/api/export/csv" && method === "GET") {
      if (!requireAdmin(req, res)) return;
      const header = ["Book ID","Book Title","Author Name","Publisher","Publication Year","ISBN Number","Category","Language","Number of Copies","Shelf Location","Description","Cover Image"];
      const rows = db.books.map((b) => [
        b.book_id, b.title, b.author, b.publisher, b.year, b.isbn,
        b.category, b.language, b.copies, b.shelf_location, b.description, b.image,
      ]);
      const csv = "﻿" + toCsv([header, ...rows]); // BOM for Excel
      send(res, 200, csv, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="Department_Geography_Library_Data.csv"',
      });
      return;
    }

    /* ---------------- Static frontend ---------------- */
    if (p.startsWith("/api/")) return send(res, 404, { error: "Unknown endpoint" });
    serveStatic(res, p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: "Internal server error" });
  }
});

function validateBook(b) {
  const errs = [];
  if (!b.title || !String(b.title).trim()) errs.push("Book title is required");
  if (!b.author || !String(b.author).trim()) errs.push("Author name is required");
  if (!b.category) errs.push("Category is required");
  else if (!db.categories.some((c) => c.category_name === b.category)) errs.push("Unknown category");
  if (b.year && (isNaN(parseInt(b.year, 10)) || parseInt(b.year, 10) < 0 || parseInt(b.year, 10) > 2100)) errs.push("Invalid publication year");
  if (b.copies !== undefined && b.copies !== "" && isNaN(parseInt(b.copies, 10))) errs.push("Copies must be a number");
  return errs;
}

server.listen(PORT, () => {
  console.log(`Department of Geography Library running at http://localhost:${PORT}`);
  console.log(`Books: ${db.books.length} | Users: ${db.users.length} | Categories: ${db.categories.length}`);
});
