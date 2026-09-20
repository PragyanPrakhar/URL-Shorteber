// Imports redis node js client's factory function
const { createClient } = require("redis");

// Creates a redis client instance using the provided Redis URL from environment variables
const redisClient = createClient({
    url: process.env.REDIS_URL,
});

redisClient.on("error", (error) => {
    console.error("Redis Client Error:", error);
});

const connectRedis = async () => {
    try {
        await redisClient.connect();
        console.log("Redis connected successfully");
    } catch (error) {
        console.error("Redis connection failed:", error.message);
        throw error;
    }
};

module.exports = {
    redisClient,
    connectRedis,
};
