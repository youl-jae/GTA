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

// 🔒 기본 유틸
const safe = (v) => (v === undefined ? null : v);
const safeUUID = (v) => (v ? v : crypto.randomUUID());

/**
 * 🔐 보안 검증
 */
async function verifyRequest(req) {
  const config = await loadConfig();

  const clientIP = req.ip.replace("::ffff:", "");

  // 1️⃣ IP 체크
  if (!config.allowedIPs.includes(clientIP)) {
    return "Blocked IP";
  }

  // 2️⃣ Bearer Token 체크
  if (req.headers.authorization !== `Bearer ${API_TOKEN}`) {
    return "Invalid token";
  }

  // 3️⃣ HMAC Signature 검증
  const signature = req.headers["x-signature"];
  const payload = JSON.stringify(req.body);

  const expected = crypto
    .createHmac("sha256", API_TOKEN)
    .update(payload)
    .digest("hex");

  if (signature !== expected) {
    return "Invalid signature";
  }

  // 4️⃣ Timestamp 검증
  const { timestamp } = req.body;

  if (!timestamp) {
    return "Missing timestamp";
  }

  const diff = Math.abs(Date.now() - timestamp);

  if (diff > 1000 * 60 * 5) {
    return "Request expired";
  }

  return null;
}

/**
 * 🔥 Rate Limit
 */
let limiter = null;
let limiterConfig = null;

router.use(async (req, res, next) => {
  try {
    const config = await loadConfig();

    // 설정이 변경되면 limiter 재생성
    const changed =
      !limiterConfig ||
      limiterConfig.windowMs !== config.rateLimit.windowMs ||
      limiterConfig.max !== config.rateLimit.max;

    if (!limiter || changed) {
      limiterConfig = {
        windowMs: config.rateLimit.windowMs,
        max: config.rateLimit.max
      };

      limiter = rateLimit({
        windowMs: limiterConfig.windowMs,
        max: limiterConfig.max,
        standardHeaders: true,
        legacyHeaders: false
      });

      console.log(
        `[RateLimit Updated] windowMs=${limiterConfig.windowMs}, max=${limiterConfig.max}`
      );
    }

    limiter(req, res, next);

  } catch (err) {
    console.error("RateLimit Error:", err);
    res.status(500).send("RateLimit Error");
  }
});

/**
 * 🔥 Sync API
 */
router.post("/sync", async (req, res) => {
  try {

    // =====================================
    // 🔥 MASTER
    // =====================================
    if (ROLE === "MASTER") {

      const error = await verifyRequest(req);

      if (error) {
        return res.status(403).send(error);
      }

      const {
        data,
        lastSync: slaveLastSync
      } = req.body;

      // 🔒 데이터 검증
      if (!Array.isArray(data)) {
        return res.status(400).send("Invalid data format");
      }

      // =====================================
      // 1️⃣ Slave → Master 반영
      // =====================================
      for (const row of data) {

        if (!row.updated_at) {
          continue;
        }

        await pool.query(`
          INSERT INTO app
          (
            uuid,
            type,
            name,
            \`order\`,
            recent_used,
            package_name,
            updated_at,
            server_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)

          ON DUPLICATE KEY UPDATE

            type = IF(
              VALUES(updated_at) > updated_at,
              VALUES(type),
              type
            ),

            \`order\` = IF(
              VALUES(updated_at) > updated_at,
              VALUES(\`order\`),
              \`order\`
            ),

            recent_used = IF(
              VALUES(updated_at) > updated_at,
              VALUES(recent_used),
              recent_used
            ),

            package_name = IF(
              VALUES(updated_at) > updated_at,
              VALUES(package_name),
              package_name
            ),

            updated_at = GREATEST(
              updated_at,
              VALUES(updated_at)
            )
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

      // =====================================
      // 2️⃣ Master → Slave 데이터 반환
      // =====================================
      const [rows] = await pool.query(`
        SELECT *
        FROM app
        WHERE updated_at > ?
      `, [slaveLastSync]);

      return res.json({
        success: true,
        data: rows,
        serverTime: new Date().toISOString()
      });
    }

    // =====================================
    // 🔥 SLAVE
    // =====================================
    if (ROLE === "SLAVE") {

      // 🔥 프론트에서 전달받은 masterUrl 사용
      const requestMasterUrl = req.body.masterUrl;

      // 기본값 fallback
      const masterUrl = requestMasterUrl || MASTER_URL;

      console.log("REQ BODY =", req.body);
      console.log("SYNC TARGET =", masterUrl);

      // 🔒 URL 검증
      if (
        !masterUrl ||
        typeof masterUrl !== "string" ||
        !masterUrl.startsWith("http")
      ) {
        return res.status(400).send("Invalid master url");
      }

      // 1️⃣ 마지막 sync 시간 조회
      const lastSync = await getLastSync();

      // 2️⃣ 로컬 변경 데이터 조회
      const [localApps] = await pool.query(`
        SELECT *
        FROM app
        WHERE updated_at > ?
      `, [lastSync]);

      const payloadObj = {
        data: localApps,
        lastSync,
        timestamp: Date.now()
      };

      const payload = JSON.stringify(payloadObj);

      // 🔐 HMAC Signature 생성
      const signature = crypto
        .createHmac("sha256", API_TOKEN)
        .update(payload)
        .digest("hex");

      console.log("REQUEST URL =", `${masterUrl}/api/admin/sync`);
      // 3️⃣ MASTER 호출
      const response = await axios.post(
        `${masterUrl}/api/admin/sync`,
        payloadObj,
        {
          timeout: 5000,
          proxy: false,

          headers: {
            Authorization: `Bearer ${API_TOKEN}`,
            "X-Signature": signature
          }
        }
      );
      console.log("RESPONSE STATUS =", response.status);
      console.log("RESPONSE DATA =", response.data);

      const masterData = response.data.data;

      // =====================================
      // 4️⃣ Master → Slave 반영
      // =====================================
      for (const row of masterData) {

        await pool.query(`
          INSERT INTO app
          (
            uuid,
            type,
            name,
            \`order\`,
            recent_used,
            package_name,
            updated_at,
            server_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)

          ON DUPLICATE KEY UPDATE

            type = IF(
              VALUES(updated_at) > updated_at,
              VALUES(type),
              type
            ),

            \`order\` = IF(
              VALUES(updated_at) > updated_at,
              VALUES(\`order\`),
              \`order\`
            ),

            recent_used = IF(
              VALUES(updated_at) > updated_at,
              VALUES(recent_used),
              recent_used
            ),

            package_name = IF(
              VALUES(updated_at) > updated_at,
              VALUES(package_name),
              package_name
            ),

            updated_at = GREATEST(
              updated_at,
              VALUES(updated_at)
            )
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

      // 5️⃣ 마지막 sync 시간 갱신
      await updateLastSync();

      return res.send("Sync Success");
    }

    return res.status(400).send("Invalid ROLE");

  } catch (err) {
    console.error("Sync Error:", err);

    if (err.response) {
      return res.status(err.response.status).send(err.response.data);
    }

    return res.status(500).send(err.message);
  }
});

module.exports = router;