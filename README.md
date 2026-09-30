# Department of Geography Library Management System

A full-stack library management web application for the Department of Geography.
**Created by Naveen Dissanayake**

## Quick Start

```bash
# 1. One-time setup: creates the database file and hashed test accounts
node seed.js

# 2. Start the server (no npm install needed - zero dependencies)
node server.js
```

Open http://localhost:3000 in your browser.

## Test Accounts (created by seed.js - change after first login, then delete seed.js)

| Role    | Username | Password   |
|---------|----------|------------|
| Admin   | Adm_123  | Geo_123    |
| User    | User_123 | User_geo   |

> Credentials are never shown anywhere in the website UI. Passwords are stored
> as salted scrypt hashes; the server only sends back a session cookie.

## Features

- **Two roles** — Administrator (full CRUD, categories, ERF management, CSV export)
  and Normal User (view/search/filter only)
- **ERF restricted access** — books in the *ERF Books* category are hidden from
  normal users; only admins and approved ERF members can see them (enforced on
  the server for every list, detail, and stats endpoint)
- **Six categories**: Human Geography, Physical Geography, GIS and RS, Others,
  English Club, ERF Books
- **CSV export** — admin dashboard exports every book field as
  `Department_Geography_Library_Data.csv`
- **Security** — scrypt password hashing, HttpOnly session cookies, role-based
  route protection, login rate limiting, security headers, server-side ERF checks
- **Responsive design** — works on desktop, tablet, and mobile

## Project Structure

```
geo-library/
├── server.js          # Backend (Node.js built-in modules, zero deps)
├── seed.js            # One-time account setup (delete after use)
├── package.json
├── database/
│   └── schema.sql     # MySQL/PostgreSQL reference schema
├── data/
│   └── db.json        # Created at runtime (JSON data store)
└── public/            # Frontend (HTML/CSS/JS)
    ├── index.html     # Home page
    ├── login.html     # Secure login
    ├── dashboard.html # User dashboard
    ├── admin.html     # Admin dashboard
    ├── book.html      # Book details
    ├── css/style.css
    └── js/*.js
```

## Migrating to MySQL/PostgreSQL

`database/schema.sql` contains the full relational schema. To move from the
built-in JSON store to MySQL/Postgres, create the tables from that file and
swap the data-access functions in `server.js` (marked section "Data layer")
for queries against your database. All business logic (auth, permissions, ERF
rules, CSV export) is already server-side and unchanged.

## Changing Passwords

There is no password in plain text anywhere in the app. To reset an account,
run this one-liner and then log in with the new password:

```bash
node -e "const fs=require('fs'),c=require('crypto');const db=JSON.parse(fs.readFileSync('data/db.json'));const s=c.randomBytes(16).toString('hex');db.users.find(u=>u.username==='Adm_123').password_hash='scrypt:'+s+':'+c.scryptSync('NEW_PASSWORD',s,64).toString('hex');fs.writeFileSync('data/db.json',JSON.stringify(db,null,2));console.log('password updated')"
```
