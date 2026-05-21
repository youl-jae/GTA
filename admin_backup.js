const express = require("express");
const router = express.Router();
const pool = require("../database/pool");

const { ROLE, API_TOKEN } = require("./serverConfig");

let lastSync = "1970-01-01 00:00:00";

const crypto = require("crypto");
const safe = (v) => (v === undefined ? null : v);
const safeUUID = (v) => (v ? v : crypto.randomUUID());

/**
 * 🔥 단일 API
 * - MASTER: 요청 받음
 * - SLAVE: 요청 보냄
 */
router.post("/sync", async (req, res) => {
  try {
    // 🔐 MASTER만 검증
    if (ROLE === "MASTER") {
      if (req.headers.authorization !== `Bearer ${API_TOKEN}`) {
        return res.status(403).send("Forbidden");
      }
    }

    // =====================================
    // 🔥 MASTER 역할 (서버)
    // =====================================
    if (ROLE === "MASTER") {
      const { data, lastSync: slaveLastSync } = req.body;

      // 1️⃣ Slave → Master 반영
      for (const row of data) {
        await pool.query(`
          INSERT INTO app
          (uuid, type, name, \`order\`, recent_used, package_name, updated_at, server_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            type = IF(VALUES(updated_at) > updated_at, VALUES(type), type),
            \`order\` = IF(VALUES(updated_at) > updated_at, VALUES(\`order\`), \`order\`),
            recent_used = IF(VALUES(updated_at) > updated_at, VALUES(recent_used), recent_used),
            package_name = IF(VALUES(updated_at) > updated_at, VALUES(package_name), package_name),
            updated_at = GREATEST(updated_at, VALUES(updated_at))
        `, [
          safeUUID(row.uuid),
          safe(row.type),
          safe(row.name),
          safe(row.order),
          safe(row.recent_used),
          safe(row.package_name),
          safe(row.updated_at),
          safe(row.server_id),
        ]);
      }

      // 2️⃣ Master → Slave 데이터 반환
      const [rows] = await pool.query(
        `SELECT * FROM app WHERE updated_at > ?`,
        [slaveLastSync]
      );

      return res.json({
        success: true,
        data: rows,
        serverTime: new Date().toISOString()
      });
    }

    // =====================================
    // 🔥 SLAVE 역할 (클라이언트)
    // =====================================
    if (ROLE === "SLAVE") {
      const axios = require("axios");

      // 1️⃣ 내 데이터 조회
      const [localApps] = await pool.query(
        `SELECT * FROM app WHERE updated_at > ?`,
        [lastSync]
      );

      // 2️⃣ Master 호출 (push + pull)
      const response = await axios.post(
      `${process.env.MASTER_URL}/api/admin/sync`,  // 🔥 수정
        {
          data: localApps,
          lastSync
        },
        {
          headers: {
            Authorization: `Bearer ${API_TOKEN}`
          }
        }
      );

      const masterData = response.data.data;

      // 3️⃣ Master 데이터 반영
      for (const row of masterData) {
        await pool.query(`
          INSERT INTO app
          (uuid, type, name, \`order\`, recent_used, package_name, updated_at, server_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            type = IF(VALUES(updated_at) > updated_at, VALUES(type), type),
            \`order\` = IF(VALUES(updated_at) > updated_at, VALUES(\`order\`), \`order\`),
            recent_used = IF(VALUES(updated_at) > updated_at, VALUES(recent_used), recent_used),
            package_name = IF(VALUES(updated_at) > updated_at, VALUES(package_name), package_name),
            updated_at = GREATEST(updated_at, VALUES(updated_at))
        `, [
          safeUUID(row.uuid),
          safe(row.type),
          safe(row.name),
          safe(row.order),
          safe(row.recent_used),
          safe(row.package_name),
          safe(row.updated_at),
          safe(row.server_id),
        ]);
      }

      // 4️⃣ sync 시간 갱신
      lastSync = new Date().toISOString().slice(0, 19).replace("T", " ");

      return res.send("Sync Success");
    }

  } catch (err) {
    console.error("Sync Error:", err);
    res.status(500).send(err.message);
  }
});

module.exports = router;