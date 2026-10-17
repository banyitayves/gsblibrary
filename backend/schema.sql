CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('Administrator', 'Librarian') NOT NULL DEFAULT 'Librarian',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS books (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  isbn VARCHAR(32) NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  author VARCHAR(180) NULL,
  publisher VARCHAR(180) NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'General',
  grade VARCHAR(40) NULL,
  shelf VARCHAR(40) NOT NULL DEFAULT 'Unassigned',
  total_copies INT UNSIGNED NOT NULL DEFAULT 1,
  available_copies INT UNSIGNED NOT NULL DEFAULT 1,
  delivered_on DATE NULL,
  published_year SMALLINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_books_title (title),
  INDEX idx_books_author (author)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  membership_number VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NULL UNIQUE,
  phone VARCHAR(32) NULL,
  member_type ENUM('Student', 'Teacher') NOT NULL DEFAULT 'Student',
  class_section VARCHAR(20) NULL,
  status ENUM('Active', 'Suspended') NOT NULL DEFAULT 'Active',
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_members_name (name),
  INDEX idx_members_class_section (class_section),
  INDEX idx_members_type (member_type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS loans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  book_id BIGINT UNSIGNED NOT NULL,
  member_id BIGINT UNSIGNED NOT NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_date DATE NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  returned_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  missed_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  returned_at TIMESTAMP NULL DEFAULT NULL,
  missed_at TIMESTAMP NULL DEFAULT NULL,
  copy_code VARCHAR(64) NULL,
  INDEX idx_loans_due_date (due_date),
  INDEX idx_loans_member (member_id),
  INDEX idx_loans_copy_code (copy_code, returned_at),
  CONSTRAINT fk_loans_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE RESTRICT,
  CONSTRAINT fk_loans_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS library_visits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  member_id BIGINT UNSIGNED NOT NULL,
  book_id BIGINT UNSIGNED NULL,
  visit_date DATE NOT NULL,
  visited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recorded_by VARCHAR(120) NOT NULL,
  INDEX idx_library_visits_date (visit_date, visited_at),
  INDEX idx_library_visits_member_date (member_id, visit_date),
  CONSTRAINT fk_library_visits_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
  CONSTRAINT fk_library_visits_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor VARCHAR(120) NOT NULL,
  action VARCHAR(120) NOT NULL,
  details VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_created_at (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  last_sent_at DATETIME NOT NULL,
  send_date DATE NOT NULL,
  send_count TINYINT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
