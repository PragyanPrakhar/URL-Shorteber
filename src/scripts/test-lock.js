require("dotenv").config();

const { connectRedis, redisClient } = require("../config/redis");
const { acquireLock, releaseLock } = require("../services/lock.service");
// Script to test the acquireLock function
const test = async () => {
    await connectRedis();

    const lockKey = "lock:test";

    /*  const token1 = await acquireLock(lockKey, 10);

    console.log("Request 1 token:", token1);

    const token2 = await acquireLock(lockKey, 10);

    console.log("Request 2 token:", token2); */
    const token1 = await acquireLock(lockKey, 10);

    console.log("Request 1 token:", token1);

    const token2 = await acquireLock(lockKey, 10);

    console.log("Request 2 token:", token2);

    const releaseResult = await releaseLock(lockKey, token2);

    console.log("Release using token 2:", releaseResult);

    const releaseResult2 = await releaseLock(lockKey, token1);

    console.log("Release using token 1:", releaseResult2);

    await redisClient.quit();
};

test();
