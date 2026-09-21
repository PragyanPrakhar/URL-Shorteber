const { getCacheStats } = require("../metrics/cache.metrics");

const getCacheMetrics = (req, res) => {
    return res.status(200).json(getCacheStats());
};

module.exports = {
    getCacheMetrics,
};
