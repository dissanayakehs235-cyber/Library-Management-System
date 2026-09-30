/**
 * One-time setup script: creates the initial admin / normal user accounts
 * with securely hashed passwords and writes them to data/db.json.
 *
 * SECURITY: This file contains TEST credentials only so the system can be
 * demonstrated. After first login, change them (see README) and delete
 * this file. The web application never displays credentials anywhere.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

const TEST_USERS = [
  // Administrator account (testing only)
  { username: "Adm_123", password: "Geo_123", role: "admin" },
  // Normal user account (testing only)
  { username: "User_123", password: "User_geo", role: "user" },
];

let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
catch { db = { users: [], books: [], categories: [], erf_members: [], sessions: [] }; }

const CATEGORIES = ["Human Geography", "Physical Geography", "GIS and RS", "Others", "English Club", "ERF Books"];
db.categories = CATEGORIES.map((name, i) => ({ category_id: i + 1, category_name: name }));

for (const t of TEST_USERS) {
  if (!db.users.some((u) => u.username === t.username)) {
    db.users.push({
      user_id: db.users.length + 1,
      username: t.username,
      password_hash: hashPassword(t.password), // hashed, never stored in plain text
      role: t.role,
    });
    console.log(`Created ${t.role} account: ${t.username}`);
  } else {
    console.log(`Account already exists: ${t.username}`);
  }
}

fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
console.log("Setup complete. You may now delete seed.js.");
