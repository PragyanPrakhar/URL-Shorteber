const { randomUUID } = require("crypto");
const { redisClient } = require("../config/redis");

const acquireLock = async (lockKey, ttlSeconds = 5) => {
    const token = randomUUID();

    const result = await redisClient.set(lockKey, token, {
        NX: true,
        EX: ttlSeconds,
    });

    if (result === "OK") {
        return token;
    }
    return null;
};

const releaseLock = async (lockKey, token) => {
    const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
        else
            return 0
        end
    `;

    return redisClient.eval(script, {
        keys: [lockKey],
        arguments: [String(token)],
    });
};

module.exports = {
    acquireLock,
    releaseLock,
};
