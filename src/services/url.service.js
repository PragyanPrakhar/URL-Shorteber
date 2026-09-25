const Url = require("../models/url.model");
const generateShortCode = require("../utils/generateShortCode");
const { redisClient } = require("../config/redis");

const {
    MAX_LOCK_ATTEMPTS,
    LOCK_RETRY_DELAY_MS,
} = require("../utils/constants");

const {
    recordHit,
    recordMiss,
    recordRedisLatency,
} = require("../metrics/cache.metrics");

const { acquireLock, releaseLock } = require("./lock.service");

const sleep = require("../utils/sleep");

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

const getUrlByShortCode = async (shortCode, attempt = 0) => {
    const cacheKey = `shortUrl:${shortCode}`;
    const lockKey = `lock:${cacheKey}`;

    // ------------------------------------------------
    // 1. Normal Redis cache lookup
    // ------------------------------------------------

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
        // Redis is only a cache.
        // If Redis fails, continue to MongoDB.

        console.error(
            `Redis GET failed | shortCode=${shortCode}`,
            error.message,
        );
    }

    // ------------------------------------------------
    // 2. Try to acquire distributed lock
    // ------------------------------------------------

    const lockToken = await acquireLock(lockKey, 5);

    if (lockToken) {
        console.log(`Lock ACQUIRED | shortCode=${shortCode}`);

        try {
            // --------------------------------------------
            // 3. Double-check Redis
            //
            // This lookup is NOT counted as another
            // cache HIT/MISS metric because it is part
            // of the lock coordination.
            // --------------------------------------------

            const cachedAfterLock = await redisClient.get(cacheKey);

            if (cachedAfterLock) {
                console.log(`Cache HIT after lock | shortCode=${shortCode}`);

                return JSON.parse(cachedAfterLock);
            }

            // --------------------------------------------
            // 4. We own the lock and cache is still empty.
            //    Fetch from MongoDB.
            // --------------------------------------------

            console.log(`Fetching MongoDB | shortCode=${shortCode}`);

            const url = await Url.findOne({
                shortUrl: shortCode,
            }).lean();

            if (!url) {
                return null;
            }

            // --------------------------------------------
            // 5. Populate Redis
            // --------------------------------------------

            try {
                await redisClient.set(cacheKey, JSON.stringify(url), {
                    EX: 3600,
                });

                console.log(`Cache populated | shortCode=${shortCode}`);
            } catch (error) {
                // MongoDB succeeded, so we can still
                // return the URL even if Redis SET fails.

                console.error(
                    `Redis SET failed | shortCode=${shortCode}`,
                    error.message,
                );
            }

            return url;
        } finally {
            // --------------------------------------------
            // 6. Release lock
            // --------------------------------------------

            await releaseLock(lockKey, lockToken);

            console.log(`Lock RELEASED | shortCode=${shortCode}`);
        }
    }

    // ------------------------------------------------
    // 7. Someone else owns the lock
    // ------------------------------------------------

    if (attempt >= MAX_LOCK_ATTEMPTS) {
        throw new Error("Could not acquire cache rebuild lock");
    }

    console.log(`Lock BUSY | shortCode=${shortCode} | attempt=${attempt + 1}`);

    await sleep(LOCK_RETRY_DELAY_MS);

    // Retry the whole process:
    //
    // Redis GET
    //     ↓
    // HIT → return
    //
    // MISS → try lock again

    return getUrlByShortCode(shortCode, attempt + 1);
};

module.exports = {
    createShortUrl,
    getUrlByShortCode,
};