const express = require("express");
const router = express.Router();
const pool = require("../database/pool");

const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const axios = require("axios");

const {
  ROLE,
  SERVER_ID,
  API_TOKEN,
  MASTER_URL,
  loadConfig,
  getLastSync,
  updateLastSync
} = require("./serverConfig");

// =====================================
// 🔥 Table Sync Config
// =====================================
const TABLE_SYNC_CONFIG = {

  // =====================================
  // MASTER DATA
  // business key 기반 full sync
  // =====================================
  project: {
    enabled: true,
    order: 1,
    mode: "business",
    businessKeys: ["name"]
  },

  app: {
    enabled: true,
    order: 2,
    mode: "business",
    businessKeys: ["name"]
  },

  chip: {
    enabled: true,
    order: 3,
    mode: "business",
    businessKeys: ["name"]
  },

  power_rail: {
    enabled: false,
    order: 4,
    mode: "business",
    businessKeys: ["name"]
  },

  test_group: {
    enabled: true,
    order: 5,
    mode: "business",
    businessKeys: ["name"]
  },

  roles: {
    enabled: false,
    order: 6,
    mode: "business",
    businessKeys: ["name"]
  },

  // =====================================
  // UUID SYNC TABLE
  // =====================================
  users: {
    enabled: false,
    order: 10,
    mode: "uuid"
  },

  comparison: {
    enabled: false,
    order: 11,
    mode: "uuid"
  },

  ip: {
    enabled: true,
    order: 20,
    mode: "business",
    businessKeys: ["name"]
  },

  app_testcase: {
    enabled: true,
    order: 21,
    mode: "business",
    businessKeys: ["app_id", "name"]
  },

  chip_info: {
    enabled: true,
    order: 22,
    mode: "business",
    businessKeys: ["chip_id", "ip_id"]
  },

  project_power_rail: {
    enabled: false,
    order: 23,
    mode: "uuid"
  },

  user_roles: {
    enabled: false,
    order: 24,
    mode: "uuid"
  },

  test: {
    enabled: true,
    order: 30,
    mode: "uuid"
  },

  testitem: {
    enabled: false,
    order: 31,
    mode: "uuid"
  },

  benchmark_score: {
    enabled: false,
    order: 40,
    mode: "uuid"
  },

  game_score: {
    enabled: false,
    order: 41,
    mode: "uuid"
  },

  performance_efficiency: {
    enabled: false,
    order: 42,
    mode: "uuid"
  },

  power: {
    enabled: false,
    order: 43,
    mode: "uuid"
  },

  comparison_aiagent: {
    enabled: false,
    order: 50,
    mode: "uuid"
  },

  comparison_test: {
    enabled: false,
    order: 51,
    mode: "uuid"
  },

  // =====================================
  // LOCAL ONLY
  // =====================================
  allowed_ips: {
    enabled: false
  },

  server_config: {
    enabled: false
  },

  sync_status: {
    enabled: false
  },

  Test: {
    enabled: false
  },

  TestItem: {
    enabled: false
  }
};

// =====================================
// 🔥 Sync Tables
// =====================================
const SYNC_TABLES =
  Object.entries(TABLE_SYNC_CONFIG)
    .filter(([_, cfg]) => cfg.enabled)
    .sort(
      (a, b) => a[1].order - b[1].order
    )
    .map(([table]) => table);

// =====================================
// 🔥 Required Columns
// =====================================
const REQUIRED_SYNC_COLUMNS = [
  "updated_at",
  "server_id"
];

// =====================================
// 🔒 Utils
// =====================================
const safe = (v) => {

  // undefined
  if (v === undefined) {
    return null;
  }

  // null
  if (v === null) {
    return null;
  }

  // Date
  if (v instanceof Date) {
    return v;
  }

  // Array or Object
  if (
    typeof v === "object"
  ) {
    return JSON.stringify(v);
  }

  return v;
};

const safeUUID = (v) => (
  v ? v : crypto.randomUUID()
);

// =====================================
// 🔥 Escape Column
// =====================================
function escapeColumn(column) {

  return `\`${column}\``;
}

// =====================================
// 🔥 Schema Validation
// =====================================
async function validateSyncSchema() {

  console.log(
    "[SYNC] validate schema start"
  );

  for (const table of SYNC_TABLES) {

    const config =
      TABLE_SYNC_CONFIG[table];

    const [rows] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    `, [table]);

    const columns =
      rows.map((r) => r.COLUMN_NAME);

    for (
      const requiredColumn
      of REQUIRED_SYNC_COLUMNS
    ) {

      if (
        !columns.includes(requiredColumn)
      ) {

        throw new Error(
          `[SCHEMA ERROR] ${table} missing column: ${requiredColumn}`
        );
      }
    }

    // =====================================
    // business mode validation
    // =====================================
    if (
      config.mode === "business"
    ) {

      for (
        const key
        of config.businessKeys
      ) {

        if (
          !columns.includes(key)
        ) {

          throw new Error(
            `[SCHEMA ERROR] ${table} missing business key: ${key}`
          );
        }
      }
    }

    // =====================================
    // uuid mode validation
    // =====================================
    if (
      config.mode === "uuid"
    ) {

      if (
        !columns.includes("uuid")
      ) {

        throw new Error(
          `[SCHEMA ERROR] ${table} missing uuid`
        );
      }
    }
  }

  console.log(
    "[SYNC] validate schema success"
  );
}

// =====================================
// 🔥 Business Upsert
// =====================================
async function upsertBusinessRow(
  conn,
  table,
  config,
  row
) {

  const businessWhere =
    config.businessKeys
      .map((k) =>
        `${escapeColumn(k)} = ?`
      )
      .join(" AND ");

  const businessValues =
    config.businessKeys.map(
      (k) => safe(row[k])
    );

  const [existsRows] =
    await conn.query(`
      SELECT *
      FROM ${table}
      WHERE ${businessWhere}
      LIMIT 1
    `, businessValues);

  const exists =
    existsRows.length > 0;

  // =====================================
  // INSERT
  // =====================================
  if (!exists) {

    const insertColumns =
      Object.keys(row)
        .filter((c) => c !== "id");

    if (
      row.uuid &&
      !insertColumns.includes("uuid")
    ) {

      insertColumns.push("uuid");
    }

    const sql = `
      INSERT INTO ${table}
      (
        ${insertColumns
          .map(escapeColumn)
          .join(", ")}
      )
      VALUES
      (
        ${insertColumns
          .map(() => "?")
          .join(", ")}
      )
    `;

    const values =
      insertColumns.map((c) => {

        if (c === "uuid") {

          return safeUUID(
            row[c]
          );
        }

        if (c === "server_id") {

          return safe(
            row[c] || SERVER_ID
          );
        }

        return safe(row[c]);
      });

    await conn.query(
      sql,
      values
    );

    return "INSERT";
  }

  // =====================================
  // UPDATE
  // =====================================
  const existingRow =
    existsRows[0];

  if (
    new Date(row.updated_at) <=
    new Date(existingRow.updated_at)
  ) {

    return "SKIP";
  }

  const updateColumns =
    Object.keys(row)
      .filter((c) => (
        c !== "id" &&
        c !== "uuid" &&
        !config.businessKeys.includes(c)
      ));

  const updateSql =
    updateColumns
      .map((c) =>
        `${escapeColumn(c)} = ?`
      )
      .join(", ");

  const sql = `
    UPDATE ${table}
    SET
      ${updateSql}
    WHERE
      ${businessWhere}
  `;

  const values = [

    ...updateColumns.map((c) => {

      if (c === "server_id") {

        return safe(
          row[c] || SERVER_ID
        );
      }

      return safe(row[c]);
    }),

    ...businessValues
  ];

  await conn.query(
    sql,
    values
  );

  return "UPDATE";
}

// =====================================
// 🔥 UUID Upsert
// =====================================
async function upsertUUIDRow(
  conn,
  table,
  row
) {

  const [existsRows] = await conn.query(`
    SELECT updated_at
    FROM ${table}
    WHERE uuid = ?
    LIMIT 1
  `, [row.uuid]);

  if (
    existsRows.length > 0 &&
    new Date(row.updated_at) <=
    new Date(existsRows[0].updated_at)
  ) {

    return "SKIP";
  }

  const columns =
    Object.keys(row)
      .filter((c) => c !== "id");

  if (!row.uuid) {

    row.uuid =
      crypto.randomUUID();

    columns.push("uuid");
  }

  const placeholders =
    columns
      .map(() => "?")
      .join(", ");

  const insertColumns =
    columns
      .map((c) =>
        escapeColumn(c)
      )
      .join(", ");

  const updateSql =
    columns
      .filter((c) => c !== "uuid")
      .map((c) => {

        if (c === "updated_at") {

          return `
            updated_at = GREATEST(
              updated_at,
              VALUES(updated_at)
            )
          `;
        }

        return `
          ${escapeColumn(c)} = IF(
            VALUES(updated_at) > updated_at,
            VALUES(${escapeColumn(c)}),
            ${escapeColumn(c)}
          )
        `;
      })
      .join(", ");

  const sql = `
    INSERT INTO ${table}
    (
      ${insertColumns}
    )
    VALUES
    (
      ${placeholders}
    )
    ON DUPLICATE KEY UPDATE
      ${updateSql}
  `;

  const values =
    columns.map((c) => {

      if (c === "server_id") {

        return safe(
          row[c] || SERVER_ID
        );
      }

      if (c === "uuid") {

        return safeUUID(
          row[c]
        );
      }

      return safe(row[c]);
    });

  const isInsert =
  existsRows.length === 0;

  await conn.query(
    sql,
    values
  );

  return isInsert
  ? "INSERT"
  : "UPDATE";
}

// =====================================
// 🔥 Generic Upsert
// =====================================
async function upsertRows(
  conn,
  table,
  rows
) {

  if (
    !rows ||
    rows.length === 0
  ) {

    console.log(`
[SYNC SKIP]
TABLE=${table}
ROWS=0
    `);

    return;
  }

  const config =
    TABLE_SYNC_CONFIG[table];

  console.log(`
=====================================
[SYNC START]
TABLE=${table}
MODE=${config.mode}
ROWS=${rows.length}
=====================================
  `);

  let successCount = 0;
  let failCount = 0;

  for (const row of rows) {

    try {

      if (!row.updated_at) {

        console.warn(`
[ROW SKIP]
TABLE=${table}
REASON=missing updated_at
        `);

        continue;
      }

      let action = "";

      // =====================================
      // business mode
      // =====================================
      if (
        config.mode === "business"
      ) {

        action =
          await upsertBusinessRow(
            conn,
            table,
            config,
            row
          );
      }

      // =====================================
      // uuid mode
      // =====================================
      else if (
        config.mode === "uuid"
      ) {

        action =
          await upsertUUIDRow(
            conn,
            table,
            row
          );
      }

      // =====================================
      // SKIP
      // =====================================
      if (action === "SKIP") {
        continue;
      }

      successCount++;

      console.log(`
      [ROW SYNC ${action}]
      TABLE=${table}
      MODE=${config.mode}
      UUID=${row.uuid || "N/A"}
      UPDATED_AT=${row.updated_at}
      `);

    } catch (err) {

      failCount++;

      console.error(`
[ROW SYNC FAIL]
TABLE=${table}
MODE=${config.mode}
UUID=${row.uuid || "N/A"}
UPDATED_AT=${row.updated_at}
MESSAGE=${err.message}
      `);

      throw err;
    }
  }

  console.log(`
=====================================
[SYNC RESULT]
TABLE=${table}
SUCCESS=${successCount}
FAIL=${failCount}
TOTAL=${rows.length}
STATUS=${failCount === 0 ? "SUCCESS" : "FAIL"}
=====================================
  `);
}

// =====================================
// 🔥 Read Changed Rows
// business:
//   full sync
//
// uuid:
//   incremental sync
// =====================================
async function getChangedRows(
  lastSync
) {

  const result = {};

  for (const table of SYNC_TABLES) {

    try {

      console.log(
        `[READ] ${table}`
      );

      const sql = `
        SELECT *
        FROM ${table}
        WHERE updated_at > ?
        ORDER BY updated_at ASC
      `;

      const params = [lastSync];

      const [rows] =
        await pool.query(
          sql,
          params
        );

      result[table] = rows;

      console.log(
        `[READ DONE] ${table} rows=${rows.length}`
      );

    } catch (err) {

      console.error(`
[READ ERROR]
TABLE=${table}
MESSAGE=${err.message}
      `);

      throw err;
    }
  }

  return result;
}

// =====================================
// 🔐 Verify Request
// =====================================
async function verifyRequest(req) {

  const config =
    await loadConfig();

  const clientIP =
    req.ip.replace(
      "::ffff:",
      ""
    );

  if (
    !config.allowedIPs.includes(clientIP)
  ) {
    return "Blocked IP";
  }

  if (
    req.headers.authorization !==
    `Bearer ${API_TOKEN}`
  ) {
    return "Invalid token";
  }

  const signature =
    req.headers["x-signature"];

  const payload =
    JSON.stringify(req.body);

  const expected = crypto
    .createHmac(
      "sha256",
      API_TOKEN
    )
    .update(payload)
    .digest("hex");

  if (signature !== expected) {
    return "Invalid signature";
  }

  const { timestamp } =
    req.body;

  if (!timestamp) {
    return "Missing timestamp";
  }

  const diff = Math.abs(
    Date.now() - timestamp
  );

  if (
    diff > 1000 * 60 * 5
  ) {
    return "Request expired";
  }

  return null;
}

/**
 * 🔥 Rate Limit
 */
let limiter = null;
let limiterConfig = null;

router.use(async (
  req,
  res,
  next
) => {

  try {

    const config =
      await loadConfig();

    const changed =
      !limiterConfig ||
      limiterConfig.windowMs !==
        config.rateLimit.windowMs ||
      limiterConfig.max !==
        config.rateLimit.max;

    if (!limiter || changed) {

      limiterConfig = {
        windowMs:
          config.rateLimit.windowMs,
        max:
          config.rateLimit.max
      };

      limiter = rateLimit({
        windowMs:
          limiterConfig.windowMs,
        max:
          limiterConfig.max,
        standardHeaders: true,
        legacyHeaders: false
      });

      console.log(`
[RateLimit Updated]
windowMs=${limiterConfig.windowMs}
max=${limiterConfig.max}
      `);
    }

    // sync API 제외
    if (req.path === "/sync") {
      return next();
    }

    limiter(req, res, next);

  } catch (err) {

    console.error(
      "RateLimit Error:",
      err
    );

    return res
      .status(500)
      .send("RateLimit Error");
  }
});

/**
 * 🔥 Sync API
 */
router.post(
  "/sync",
  async (req, res) => {

    let conn = null;

    try {

      await validateSyncSchema();

      // =====================================
      // MASTER
      // =====================================
      if (ROLE === "MASTER") {

        const error =
          await verifyRequest(req);

        if (error) {

          return res
            .status(403)
            .send(error);
        }

        const {
          data,
          lastSync:
            slaveLastSync
        } = req.body;

        conn =
          await pool.getConnection();

        await conn.beginTransaction();

        // =====================================
        // Slave -> Master
        // =====================================
        for (const table of SYNC_TABLES) {

          const rows =
            data[table];

          if (
            !rows ||
            rows.length === 0
          ) {

            console.log(`
        [MASTER SYNC SKIP]
        TABLE=${table}
        ROWS=0
            `);

            continue;
          }

          try {

            console.log(`
        #####################################
        [MASTER RECEIVE START]
        TABLE=${table}
        ROWS=${rows.length}
        #####################################
            `);

            await upsertRows(
              conn,
              table,
              rows
            );

            console.log(`
        [MASTER SYNC SUCCESS]
        TABLE=${table}
        ROWS=${rows.length}
            `);

          } catch (err) {

            console.error(`
        [MASTER SYNC FAIL]
        TABLE=${table}
        ROWS=${rows.length}
        MESSAGE=${err.message}
            `);

            throw err;
          }
        }

        await conn.commit();

        // =====================================
        // Master -> Slave
        // =====================================
        const syncData =
          await getChangedRows(
            slaveLastSync
          );

        return res.json({
          success: true,
          data: syncData,
          serverTime:
            new Date().toISOString()
        });
      }

      // =====================================
      // SLAVE
      // =====================================
      if (ROLE === "SLAVE") {

        const requestMasterUrl =
          req.body.masterUrl;

        const masterUrl =
          requestMasterUrl ||
          MASTER_URL;

        const lastSync =
          await getLastSync();

        const localData =
          await getChangedRows(
            lastSync
          );

        const payloadObj = {
          data: localData,
          lastSync,
          timestamp: Date.now()
        };

        const payload =
          JSON.stringify(
            payloadObj
          );

        const signature = crypto
          .createHmac(
            "sha256",
            API_TOKEN
          )
          .update(payload)
          .digest("hex");

        const response =
          await axios.post(
            `${masterUrl}/api/admin/sync`,
            payloadObj,
            {
              timeout: 300000,
              proxy: false,

              headers: {
                Authorization:
                  `Bearer ${API_TOKEN}`,
                "X-Signature":
                  signature
              }
            }
          );

        const masterData =
          response.data.data;

        conn =
          await pool.getConnection();

        await conn.beginTransaction();

        // =====================================
        // Master -> Slave
        // =====================================
        for (const table of SYNC_TABLES) {

          const rows =
            masterData[table];

          if (
            !rows ||
            rows.length === 0
          ) {

            console.log(`
        [SLAVE SYNC SKIP]
        TABLE=${table}
        ROWS=0
            `);

            continue;
          }

          try {

            console.log(`
        #####################################
        [SLAVE RECEIVE START]
        TABLE=${table}
        ROWS=${rows.length}
        #####################################
            `);

            await upsertRows(
              conn,
              table,
              rows
            );

            console.log(`
        [SLAVE SYNC SUCCESS]
        TABLE=${table}
        ROWS=${rows.length}
            `);

          } catch (err) {

            console.error(`
        [SLAVE SYNC FAIL]
        TABLE=${table}
        ROWS=${rows.length}
        MESSAGE=${err.message}
            `);

            throw err;
          }
        }

        await conn.commit();

        await updateLastSync();

        return res.send(
          "Sync Success"
        );
      }

      return res
        .status(400)
        .send("Invalid ROLE");

    } catch (err) {

      console.error(
        "Sync Error:",
        err
      );

      try {

        if (conn) {
          await conn.rollback();
        }

      } catch (rollbackErr) {

        console.error(
          "Rollback Error:",
          rollbackErr
        );
      }

      if (err.response) {

        return res
          .status(
            err.response.status
          )
          .send(
            err.response.data
          );
      }

      return res
        .status(500)
        .send(err.message);

    } finally {

      try {

        if (conn) {
          conn.release();
        }

      } catch (releaseErr) {

        console.error(
          "Connection Release Error:",
          releaseErr
        );
      }
    }
  }
);

// =====================================
// 🔥 EXPORT
// =====================================
module.exports = router;