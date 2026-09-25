const Url = require("../models/url.model");
const generateShortCode = require("../utils/generateShortCode");
const { redisClient } = require("../config/redis");

const {
    recordHit,
    recordMiss,
    recordRedisLatency,
} = require("../metrics/cache.metrics");

const createShortUrl = async (originalUrl) => {
    const url = new Url({
        originalUrl,
        clickCount: 0,
    });

    // Mongoose has already generated _id.
    const shortCode = generateShortCode(url._id);

    url.shortUrl = shortCode;

    await url.save();

    return url;
};

const getUrlByShortCode = async (shortCode) => {
    const cacheKey = `shortUrl:${shortCode}`;
    // 1. Try Redis GET
    let cachedUrl = null;

    try {
        const startTime = performance.now();

        cachedUrl = await redisClient.get(cacheKey);

        const redisLatency = performance.now() - startTime;

        recordRedisLatency(redisLatency);

        if (cachedUrl) {
            recordHit();

            console.log(
                `Cache HIT | shortCode=${shortCode} | Redis latency=${redisLatency.toFixed(2)}ms`,
            );

            return JSON.parse(cachedUrl);
        }

        recordMiss();

        console.log(
            `Cache MISS | shortCode=${shortCode} | Redis latency=${redisLatency.toFixed(2)}ms`,
        );
    } catch (error) {
        // Redis failed, but Redis is only a cache.
        // We can still use MongoDB.

        console.error(
            `Redis GET failed | shortCode=${shortCode}`,
            error.message,
        );
    }

    // 2. MongoDB

    let url;

    try {
        url = await Url.findOne({
            shortUrl: shortCode,
        }).lean();
    } catch (error) {
        // MongoDB is our source of truth.
        // If MongoDB fails, we cannot continue.

        console.error(
            `MongoDB lookup failed | shortCode=${shortCode}`,
            error.message,
        );

        throw error;
    }

    if (!url) {
        return null;
    }
    // 3. Try Redis SET
    try {
        await redisClient.set(cacheKey, JSON.stringify(url), {
            EX: 3600,
        });
    } catch (error) {
        // Redis failed while trying to populate the cache.
        // The URL was already obtained from MongoDB,
        // so we can still return it to the client.

        console.error(
            `Redis SET failed | shortCode=${shortCode}`,
            error.message,
        );
    }

    return url;
};

module.exports = {
    createShortUrl,
    getUrlByShortCode,
};
