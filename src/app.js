const express = require("express");

const urlRoutes = require("./routes/url.routes");
const cacheRoutes = require("./routes/cache.routes");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.send("URL Shortener API is running");
});

app.use("/api/v1/urls", urlRoutes);
app.use("/internal/cache", cacheRoutes);

module.exports = app;
