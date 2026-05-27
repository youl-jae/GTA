const pool = require("../database/pool");

// 🔹 환경 변수
const ROLE = process.env.SERVER_ROLE || "SLAVE";
const SERVER_ID = process.env.SERVER_ID || "SERVER_2";
const API_TOKEN = process.env.API_TOKEN || "SECRET_KEY";

// 🔹 MASTER 서버 URL
const MASTER_URL =
  process.env.MASTER_URL || "http://192.168.1.12:3000";

// 🔹 캐시
let cache = {
  allowedIPs: [],
  rateLimit: {
    windowMs: 60000,
    max: 60
  },
  lastLoaded: 0
};

const CACHE_TTL = 5000;

/**
 * 🔹 설정 로딩
 */
async function loadConfig() {
  const now = Date.now();

  if (now - cache.lastLoaded < CACHE_TTL) {
    return cache;
  }

  // allowed IP
  const [ips] = await pool.query(
    "SELECT ip FROM allowed_ips WHERE enabled = 1"
  );

  cache.allowedIPs = ips.map(r => r.ip);

  // rate limit
  const [configs] = await pool.query(
    "SELECT config_key, config_value FROM server_config"
  );

  configs.forEach(c => {
    if (c.config_key === "RATE_LIMIT_MAX") {
      cache.rateLimit.max = parseInt(c.config_value);
    }

    if (c.config_key === "RATE_LIMIT_WINDOW") {
      cache.rateLimit.windowMs = parseInt(c.config_value);
    }
  });

  cache.lastLoaded = now;

  return cache;
}

/**
 * 🔹 last sync 조회
 */
async function getLastSync(
  table
) {

  const [rows] =
    await pool.query(
      `
      SELECT last_sync
      FROM sync_status
      WHERE server_id = ?
      AND table_name = ?
      `,
      [
        SERVER_ID,
        table
      ]
    );

  return rows.length
    ? rows[0].last_sync
    : "1970-01-01 00:00:00";
}

/**
 * 🔹 last sync 갱신
 */
async function updateLastSync(
  table,
  syncTime
) {

  await pool.query(`
    INSERT INTO sync_status
    (
      server_id,
      table_name,
      last_sync
    )
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      last_sync = VALUES(last_sync)
  `, [
    SERVER_ID,
    table,
    syncTime
  ]);
}

module.exports = {
  ROLE,
  SERVER_ID,
  API_TOKEN,
  MASTER_URL,

  loadConfig,

  getLastSync,
  updateLastSync
};