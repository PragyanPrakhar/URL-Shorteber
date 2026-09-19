const express = require("express");

const { createUrl, redirectToOriginalUrl } = require("../controllers/url.controller");

const router = express.Router();

router.post("/", createUrl);
router.get("/:shortCode", redirectToOriginalUrl);

module.exports = router;
