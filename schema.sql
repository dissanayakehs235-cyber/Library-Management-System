-- =============================================================
-- Department of Geography Library Management System
-- Database schema (MySQL 8+ / PostgreSQL compatible)
-- Created by Naveen Dissanayake
-- =============================================================

CREATE TABLE users (
    user_id            INT PRIMARY KEY AUTO_INCREMENT,
    username           VARCHAR(50)  NOT NULL UNIQUE,
    password_hash      VARCHAR(255) NOT NULL,           -- scrypt/argon2/bcrypt hash only
    role               ENUM('admin','user') NOT NULL DEFAULT 'user',
    erf_member_status  TINYINT(1)   NOT NULL DEFAULT 0
);

CREATE TABLE categories (
    category_id    INT PRIMARY KEY AUTO_INCREMENT,
    category_name  VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE books (
    book_id         INT PRIMARY KEY AUTO_INCREMENT,
    title           VARCHAR(255) NOT NULL,
    author          VARCHAR(150) NOT NULL,
    publisher       VARCHAR(150),
    year            SMALLINT,
    isbn            VARCHAR(20),
    category        VARCHAR(100) NOT NULL,
    language        VARCHAR(50),
    copies          INT NOT NULL DEFAULT 1,
    shelf_location  VARCHAR(50),
    description     TEXT,
    image           VARCHAR(255),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category) REFERENCES categories(category_name)
);

CREATE TABLE erf_members (
    member_id       INT PRIMARY KEY AUTO_INCREMENT,
    user_id         INT NOT NULL,
    approval_status ENUM('pending','approved','revoked') NOT NULL DEFAULT 'pending',
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Seed the six required categories
INSERT INTO categories (category_name) VALUES
  ('Human Geography'),
  ('Physical Geography'),
  ('GIS and RS'),
  ('Others'),
  ('English Club'),
  ('ERF Books');
