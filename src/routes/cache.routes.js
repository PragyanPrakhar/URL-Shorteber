const express = require("express");

const { getCacheMetrics } = require("../controllers/cache.controller");

const router = express.Router();

router.get("/stats", getCacheMetrics);

module.exports = router;
