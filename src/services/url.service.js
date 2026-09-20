const Url = require("../models/url.model");
const generateShortCode = require("../utils/generateShortCode");
const {redisClient} = require("../config/redis");

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
        // Generating the cache key
        const cacheKey = `shortUrl:${shortCode}`;
        // Check if the URL is in the cache
        const cachedUrl = await redisClient.get(cacheKey);
        if (cachedUrl) {
            console.log("Cache hit for short code:", shortCode);
            return JSON.parse(cachedUrl);
        }
        console.log("Cache miss for short code:", shortCode);
        // If not in cache, fetch from the database
        const url = await Url.findOne({ shortUrl: shortCode }).lean(); // Using lean() for better performance
        if (!url) {
            return null;
        }
        // Store the result in the cache for future requests
        await redisClient.set(cacheKey, JSON.stringify(url), {
            EX: 3600, // Cache for 1 hour
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
