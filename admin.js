const express = require("express");
const router = express.Router();
const pool = require("../database/pool");

const fs = require("fs");
const path = require("path");

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

// allowed ip 목록 조회
router.get(
  "/allowed-ips",
  async (req, res) => {

    try {

      const [rows] =
        await pool.query(`
          SELECT
            ip,
            description
          FROM allowed_ips
          WHERE enabled = 1
          ORDER BY id ASC
        `);

      res.json(rows);

    } catch (err) {

      console.error(err);

      res
        .status(500)
        .json({
          message:
            "Failed to load allowed ips"
        });
    }
  }
);

router.post(
  "/allowed-ips",
  async (req, res) => {

    try {

      const {
        ip,
        description
      } = req.body;

      await pool.query(`
        INSERT INTO allowed_ips
        (
          ip,
          description,
          enabled
        )
        VALUES (?, ?, 1)
        ON DUPLICATE KEY UPDATE
          enabled = 1,
          description = VALUES(description)
      `, [
        ip,
        description
      ]);

      res.json({
        success: true
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        message:
          "Failed to add allowed ip"
      });
    }
  }
);

router.put(
  "/allowed-ips/:oldIp",
  async (req, res) => {

    try {

      const { oldIp } = req.params;

      const {
        ip,
        description
      } = req.body;

      await pool.query(`
        UPDATE allowed_ips
        SET
          ip = ?,
          description = ?
        WHERE ip = ?
      `, [
        ip,
        description,
        oldIp
      ]);

      res.json({
        success: true
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        message:
          "Failed to modify allowed ip"
      });
    }
  }
);

router.delete(
  "/allowed-ips/:ip",
  async (req, res) => {

    try {

      const { ip } =
        req.params;

      await pool.query(`
        UPDATE allowed_ips
        SET enabled = 0
        WHERE ip = ?
      `, [ip]);

      res.json({
        success: true
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        message:
          "Failed to delete allowed ip"
      });
    }
  }
);

// =====================================
// 🔥 GET SERVER ROLE
// =====================================
router.get(
  "/server-role",
  (req, res) => {

    return res.json({
      role: ROLE
    });
  }
);

// =====================================
// 🔥 Table Sync Config File
// =====================================
const TABLE_SYNC_CONFIG_PATH =
  path.join(
    __dirname,
    "../config/table-sync-config.json"
  );

router.get(
  "/table-sync-config",
  (req, res) => {

    try {

      const config = JSON.parse(
        fs.readFileSync(
          TABLE_SYNC_CONFIG_PATH,
          "utf8"
        )
      );

      const result =
        Object.entries(config)
          .map(([table, value]) => ({

            table,

            enabled:
              value.enabled ?? false,

            order:
              value.order ?? 9999,
          }))
          .sort(
            (a, b) =>
              a.order - b.order
          );

      res.json(result);

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error:
          "failed to load config"
      });
    }
  }
);

router.post(
  "/table-sync-config",
  (req, res) => {

    try {

      const updates = req.body;

      const config = JSON.parse(
        fs.readFileSync(
          TABLE_SYNC_CONFIG_PATH,
          "utf8"
        )
      );

      for (const item of updates) {

        if (!config[item.table]) {
          continue;
        }

        config[item.table].enabled =
          item.enabled;
      }

      saveTableSyncConfig(config);

      loadConfig();

      res.json({
        success: true
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error:
          "failed to save config"
      });
    }
  }
);

// =====================================
// 🔥 Load Table Sync Config
// =====================================
let cachedTableSyncConfig = null;

function loadTableSyncConfig() {

  if (cachedTableSyncConfig) {
    return cachedTableSyncConfig;
  }

  const raw = fs.readFileSync(
    TABLE_SYNC_CONFIG_PATH,
    "utf8"
  );

  cachedTableSyncConfig =
    JSON.parse(raw);

  return cachedTableSyncConfig;
}

// =====================================
// 🔥 Save Table Sync Config
// =====================================
function saveTableSyncConfig(config) {

  fs.writeFileSync(
    TABLE_SYNC_CONFIG_PATH,
    JSON.stringify(
      config,
      null,
      2
    )
  );

  cachedTableSyncConfig =
    config;
}
// =====================================
// 🔥 Get Sync Tables
// =====================================
function getSyncTables() {

  const config =
    loadTableSyncConfig();

  return Object.entries(config)
    .filter(([_, cfg]) =>
      cfg.enabled
    )
    .sort(
      (a, b) =>
        (a[1].order || 0) -
        (b[1].order || 0)
    )
    .map(([table]) => table);
}

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
// 🔥 Save Sync Error Log
// =====================================
async function saveSyncErrorLog({

  tableName,
  syncDirection,
  actionType,
  uuid,
  errorMessage,
  stackTrace,
  payload

}) {

  try {

    await pool.query(`
      INSERT INTO sync_error_logs
      (
        role,
        table_name,
        sync_direction,
        action_type,
        uuid,
        error_message,
        stack_trace,
        payload_json
      )
      VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
    `, [

      ROLE,

      tableName || null,

      syncDirection || null,

      actionType || null,

      uuid || null,

      errorMessage || null,

      stackTrace || null,

      payload
        ? JSON.stringify(payload)
        : null
    ]);

  } catch (err) {

    console.error(`
[SYNC ERROR LOG SAVE FAIL]
MESSAGE=${err.message}
    `);
  }
}

// =====================================
// 🔥 Escape Column
// =====================================
function escapeColumn(column) {

  return `\`${column}\``;
}

// =====================================
// 🔥 Schema Validation
// =====================================
async function validateSyncSchema(syncTables = null) {

  console.log(
    "[SYNC] validate schema start"
  );

  const TABLE_SYNC_CONFIG =
    loadTableSyncConfig();

  const SYNC_TABLES =
    syncTables ||
    getSyncTables();

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

        const errMsg =
          `[SCHEMA ERROR][${ROLE}] ${table} missing column: ${requiredColumn}`;

        await saveSyncErrorLog({

          tableName: table,

          syncDirection: ROLE,

          actionType: "SCHEMA_VALIDATION",

          errorMessage: errMsg
        });

        const err = new Error(errMsg);

        err.alreadyLogged = true;

        throw err;
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

          const errMsg =
            `[SCHEMA ERROR][${ROLE}] ${table} missing business key: ${key}`;

          await saveSyncErrorLog({

            tableName: table,

            syncDirection: ROLE,

            actionType: "SCHEMA_VALIDATION",

            errorMessage: errMsg
          });

          const err = new Error(errMsg);

          err.alreadyLogged = true;

          throw err;
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

        const errMsg =
          `[SCHEMA ERROR][${ROLE}] ${table} missing uuid`;

        await saveSyncErrorLog({

          tableName: table,

          syncDirection: ROLE,

          actionType: "SCHEMA_VALIDATION",

          errorMessage: errMsg
        });

        const err = new Error(errMsg);

        err.alreadyLogged = true;

        throw err;
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

  const TABLE_SYNC_CONFIG =
    loadTableSyncConfig();

  const config =
    TABLE_SYNC_CONFIG[table];

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

      await saveSyncErrorLog({

        tableName: table,

        syncDirection: ROLE,

        actionType: "ROW_SYNC",

        uuid: row.uuid || null,

        errorMessage: err.message,

        stackTrace: err.stack,

        payload: row
      });

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
  lastSyncMap,
  syncTables = null
) {

  const result = {};

  const SYNC_TABLES =
    syncTables ||
    getSyncTables();

  for (const table of SYNC_TABLES) {

    try {

      console.log(
        `[READ] ${table}`
      );

      const tableLastSync =
        lastSyncMap?.[table] ||
        "1970-01-01 00:00:00";

      const sql = `
        SELECT *
        FROM ${table}
        WHERE updated_at > ?
        ORDER BY updated_at ASC
      `;

      const [rows] =
        await pool.query(
          sql,
          [tableLastSync]
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

      await saveSyncErrorLog({

        tableName: table,

        syncDirection: ROLE,

        actionType: "READ_CHANGED_ROWS",

        errorMessage: err.message,

        stackTrace: err.stack
      });

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
    (
      req.headers["x-forwarded-for"] ||
      req.ip ||
      ""
    )
      .toString()
      .split(",")[0]
      .trim()
      .replace("::ffff:", "");

  const [rows] =
    await pool.query(`
      SELECT id
      FROM allowed_ips
      WHERE ip = ?
      AND enabled = 1
      LIMIT 1
    `, [clientIP]);

  if (rows.length === 0) {

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
      // =====================================
      // MASTER
      // - Handle sync request from Slave
      // - Receive Slave changes
      // - Return Master changes
      // =====================================
      if (ROLE === "MASTER") {

        const syncTables =
          req.body.syncTables ||
          getSyncTables();

        await validateSyncSchema(
          syncTables
        );

        // =====================================
        // MASTER MANUAL SYNC
        // - Master triggers sync on Slave
        // - Slave starts bidirectional sync
        // =====================================
        if (
          !req.headers.authorization &&
          !req.body.internalSync
        ) {

          const { targetUrl } =
            req.body;

          if (!targetUrl) {

            return res
              .status(400)
              .send("Missing targetUrl");
          }

          console.log(`
        [MASTER PUSH SYNC]
        TARGET=${targetUrl}
          `);

          const syncTables =
            getSyncTables();

          const response =
            await axios.post(
              `${targetUrl}/api/admin/sync`,
              {
                masterUrl: MASTER_URL,
                internalSync: true,
                syncTables
              },
              {
                timeout: 300000,
                proxy: false
              }
            );

          return res.json({
            success: true,
            target: targetUrl,
            result:
              response.data
          });
        }


        const error =
          await verifyRequest(req);

        if (error) {

          return res
            .status(403)
            .send(error);
        }

        const {
          data,
          lastSyncMap:
            slaveLastSyncMap
        } = req.body;

        conn =
          await pool.getConnection();

        await conn.beginTransaction();

        const TABLE_SYNC_CONFIG =
          loadTableSyncConfig();

        const SYNC_TABLES =
          syncTables;

        // =====================================
        // Receive changed rows from Slave
        // Sync Direction:
        //   Slave -> Master
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
        // Return changed rows to Slave
        // Sync Direction:
        //   Master -> Slave
        // =====================================
        const syncData =
          await getChangedRows(
            slaveLastSyncMap,
            syncTables
          );

        return res.json({
          success: true,
          data: syncData,
          serverTime:
            new Date()
              .toISOString()
              .slice(0, 19)
              .replace("T", " ")
        });
      }

      // =====================================
      // SLAVE
      // - Send local changes to Master
      // - Receive latest changes from Master
      // =====================================
      if (ROLE === "SLAVE") {
        
        const syncTables =
          req.body.syncTables ||
          getSyncTables();

        await validateSyncSchema(
          syncTables
        );

        const requestMasterUrl =
          req.body.masterUrl;

        const masterUrl =
          requestMasterUrl ||
          MASTER_URL;

        const SYNC_TABLES =
          syncTables;

        const lastSyncMap = {};

        for (const table of SYNC_TABLES) {

          lastSyncMap[table] =
            await getLastSync(
              table
            );
        }

        // =====================================
        // Read local changed rows
        // to upload to Master
        // =====================================
        const localData =
          await getChangedRows(
            lastSyncMap,
            syncTables
          );

        const payloadObj = {
          data: localData,
          lastSyncMap,
          syncTables,
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
          // =====================================
          // Send Slave changes to Master
          // Sync Direction:
          //   Slave -> Master
          // =====================================
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
        // Apply changed rows from Master
        // Sync Direction:
        //   Master -> Slave
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

        const syncTime =
          response.data.serverTime;

        for (const table of SYNC_TABLES) {

          await updateLastSync(
            table,
            syncTime
          );
        }

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

      if (!err.alreadyLogged) {

        await saveSyncErrorLog({

          tableName: "GLOBAL",

          syncDirection: ROLE,

          actionType: "SYNC",

          errorMessage: err.message,

          stackTrace: err.stack,

          payload: req.body
        });
      }

      try {

        if (conn) {
          await conn.rollback();
        }

      } catch (rollbackErr) {

        console.error(
          "Rollback Error:",
          rollbackErr
        );

        await saveSyncErrorLog({

          tableName: "GLOBAL",

          syncDirection: ROLE,

          actionType: "ROLLBACK",

          errorMessage: rollbackErr.message,

          stackTrace: rollbackErr.stack
        });
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
// 🔥 Get Sync Error Logs
// =====================================
router.get(
  "/sync-error-logs",
  async (req, res) => {

    try {

      const limit =
        Number(req.query.limit || 100);

      const offset =
        Number(req.query.offset || 0);

      const [rows] =
        await pool.query(`
          SELECT *
          FROM sync_error_logs
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `, [
          limit,
          offset
        ]);

      res.json(rows);

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error:
          "failed to load sync error logs"
      });
    }
  }
);

router.put(
  "/sync-error-logs/:id/resolve",
  async (req, res) => {

    try {

      await pool.query(`
        UPDATE sync_error_logs
        SET resolved = 1
        WHERE id = ?
      `, [req.params.id]);

      res.json({
        success: true
      });

    } catch (err) {

      res.status(500).json({
        error: err.message
      });
    }
  }
);

// =====================================
// 🔥 EXPORT
// =====================================
module.exports = router;