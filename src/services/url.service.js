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
    try {
        // Generate cache key
        const cacheKey = `shortUrl:${shortCode}`;

        // Measure Redis GET latency
        const startTime = performance.now();

        const cachedUrl = await redisClient.get(cacheKey);

        const redisLatency = performance.now() - startTime;

        // Record Redis latency
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

        // Cache miss → MongoDB
        const url = await Url.findOne({
            shortUrl: shortCode,
        }).lean();

        if (!url) {
            return null;
        }

        // Store result in Redis
        await redisClient.set(cacheKey, JSON.stringify(url), {
            EX: 3600,
        });

        return url;
    } catch (error) {
        console.log("Error fetching URL by short code:", error);

        throw error;
    }
};

module.exports = {
    createShortUrl,
    getUrlByShortCode,
};
