-- Categories table
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  icon TEXT DEFAULT NULL,
  excluded_from_budget INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Bank accounts table
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  initial_balance REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
  amount REAL NOT NULL CHECK(amount > 0),
  category_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- Monthly budgets table
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  year INTEGER NOT NULL,
  amount REAL NOT NULL CHECK(amount >= 0),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(month, year)
);

-- User settings (single row)
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  alert_threshold_percent INTEGER DEFAULT 20
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions(type, date);

-- Default categories
INSERT OR IGNORE INTO categories (name) VALUES ('Food');
INSERT OR IGNORE INTO categories (name) VALUES ('Transport');
INSERT OR IGNORE INTO categories (name) VALUES ('Housing');
INSERT OR IGNORE INTO categories (name) VALUES ('Utilities');
INSERT OR IGNORE INTO categories (name) VALUES ('Entertainment');
INSERT OR IGNORE INTO categories (name) VALUES ('Health');
INSERT OR IGNORE INTO categories (name) VALUES ('Shopping');
INSERT OR IGNORE INTO categories (name) VALUES ('Investments');
INSERT OR IGNORE INTO categories (name) VALUES ('Salary');
INSERT OR IGNORE INTO categories (name) VALUES ('Other');

-- Default settings
INSERT OR IGNORE INTO settings (id, alert_threshold_percent) VALUES (1, 20);
