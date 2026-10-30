-- AUTO CREW: начальная схема (MVP). Деньги — целые рубли. Время — миллисекунды Unix.

CREATE TABLE players (
  tg_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  lang TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  banned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  owner_tg_id INTEGER NOT NULL REFERENCES players(tg_id),
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  stage INTEGER NOT NULL DEFAULT 0,
  cash INTEGER NOT NULL,
  reputation REAL NOT NULL DEFAULT 0,
  orders_done INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  tick_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ad_id TEXT,
  ad_until INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'bankrupt', 'closed'))
);
-- У игрока одна действующая компания; закрытые остаются в истории.
CREATE UNIQUE INDEX companies_owner_open ON companies(owner_tg_id) WHERE status != 'closed';
CREATE UNIQUE INDEX companies_name_open ON companies(name_norm) WHERE status != 'closed';

-- Защита от гонок. Каждый пакет записи первой строкой вставляет сюда новую версию
-- и флаг ok = (текущая версия в companies = версия, с которой запрос начинал).
-- Если за это время кто-то записал состояние, ok = 0, CHECK падает и D1 откатывает весь пакет.
CREATE TABLE company_versions (
  company_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  ok INTEGER CHECK (ok IS NULL OR ok = 1),
  PRIMARY KEY (company_id, version)
);

-- Идемпотентность команд: повтор того же op_id возвращает сохранённый результат.
CREATE TABLE ops (
  tg_id INTEGER NOT NULL,
  op_id TEXT NOT NULL,
  type TEXT NOT NULL,
  result TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (tg_id, op_id)
);
CREATE INDEX ops_at ON ops(at);

CREATE TABLE tools (
  company_id TEXT NOT NULL REFERENCES companies(id),
  tool_id TEXT NOT NULL,
  wear REAL NOT NULL DEFAULT 0,
  broken INTEGER NOT NULL DEFAULT 0,
  bought_at INTEGER NOT NULL,
  PRIMARY KEY (company_id, tool_id)
);

CREATE TABLE inventory (
  company_id TEXT NOT NULL REFERENCES companies(id),
  part_id TEXT NOT NULL,
  grade TEXT NOT NULL CHECK (grade IN ('eco', 'orig')),
  qty INTEGER NOT NULL CHECK (qty >= 0),
  avg_cost INTEGER NOT NULL,
  PRIMARY KEY (company_id, part_id, grade)
);

-- Заказ на ремонт вместе со снимком клиента и машины. Отдельные таблицы клиентов
-- и автомобилей появятся вместе с постоянными клиентами и перепродажей (этап 5).
CREATE TABLE repair_orders (
  company_id TEXT NOT NULL REFERENCES companies(id),
  id TEXT NOT NULL,
  arrived_at INTEGER NOT NULL,
  leave_at INTEGER NOT NULL,
  customer TEXT NOT NULL,
  sens REAL NOT NULL,
  car TEXT NOT NULL,
  symptom TEXT NOT NULL,
  job_types TEXT NOT NULL,
  inspected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'accepted', 'in_progress', 'done', 'left')),
  price_level TEXT,
  grade TEXT,
  labor INTEGER NOT NULL DEFAULT 0,
  parts_price INTEGER NOT NULL DEFAULT 0,
  parts_cost INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL DEFAULT 0,
  done_at INTEGER NOT NULL DEFAULT 0,
  complaint_at INTEGER NOT NULL DEFAULT 0,
  complaint_done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, id)
);
CREATE INDEX repair_orders_status ON repair_orders(company_id, status);

CREATE TABLE purchase_orders (
  company_id TEXT NOT NULL REFERENCES companies(id),
  id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  lines TEXT NOT NULL,
  total INTEGER NOT NULL,
  fee INTEGER NOT NULL,
  ordered_at INTEGER NOT NULL,
  eta_promised INTEGER NOT NULL,
  eta INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered')),
  PRIMARY KEY (company_id, id)
);
CREATE INDEX purchase_orders_status ON purchase_orders(company_id, status);

-- Журнал денег: касса компании = сумма проводок.
CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id),
  at INTEGER NOT NULL,
  day TEXT NOT NULL,
  amount INTEGER NOT NULL,
  category TEXT NOT NULL,
  ref TEXT
);
CREATE INDEX ledger_company_day ON ledger(company_id, day);

CREATE TABLE feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id),
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX feed_company ON feed(company_id, id);

-- Публикации в канал (черновик → одобрение администратором → отправка).
CREATE TABLE telegram_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'failed', 'cancelled')),
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  message_id INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE UNIQUE INDEX telegram_posts_ref ON telegram_posts(kind, ref) WHERE status != 'cancelled';

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor INTEGER,
  action TEXT NOT NULL,
  data TEXT,
  at INTEGER NOT NULL
);
