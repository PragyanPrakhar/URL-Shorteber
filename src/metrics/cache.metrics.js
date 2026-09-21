const cacheMetrics = {
    hits: 0,
    misses: 0,
    redisLatency: {
        count: 0,
        totalMs: 0,
        minMs: Infinity,
        maxMs: 0,
    },
};

const recordHit = () => {
    cacheMetrics.hits++;
};

const recordMiss = () => {
    cacheMetrics.misses++;
};

const recordRedisLatency = (latencyMs) => {
    const latency = cacheMetrics.redisLatency;

    latency.count++;
    latency.totalMs += latencyMs;
    latency.minMs = Math.min(latency.minMs, latencyMs);
    latency.maxMs = Math.max(latency.maxMs, latencyMs);
};

const getCacheStats = () => {
    const totalRequests = cacheMetrics.hits + cacheMetrics.misses;

    const hitRatio =
        totalRequests === 0 ? 0 : cacheMetrics.hits / totalRequests;

    const averageLatency =
        cacheMetrics.redisLatency.count === 0
            ? 0
            : cacheMetrics.redisLatency.totalMs / cacheMetrics.redisLatency.count;

    return {
        hits: cacheMetrics.hits,
        misses: cacheMetrics.misses,
        totalRequests,
        hitRatio: Number(hitRatio.toFixed(4)),
        hitRatioPercentage: Number((hitRatio * 100).toFixed(2)),

        redisLatency: {
            count: cacheMetrics.redisLatency.count,
            averageMs: Number(averageLatency.toFixed(2)),
            minMs:
                cacheMetrics.redisLatency.count === 0
                    ? 0
                    : Number(cacheMetrics.redisLatency.minMs.toFixed(2)),
            maxMs: Number(cacheMetrics.redisLatency.maxMs.toFixed(2)),
        },
    };
};

module.exports = {
    recordHit,
    recordMiss,
    recordRedisLatency,
    getCacheStats,
};
