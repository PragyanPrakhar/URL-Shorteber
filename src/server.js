require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("./config/db");
const app = require("./app");
const { connectRedis, redisClient } = require("./config/redis");

const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        await connectDB();
        await connectRedis();

        const server = app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });

        let isShuttingDown = false;

        const shutdown = async (signal) => {
            if (isShuttingDown) {
                return;
            }

            isShuttingDown = true;

            console.log(
                `${signal} received. Shutting down gracefully...`
            );

            setTimeout(() => {
                console.error(
                    "Graceful shutdown timed out. Forcefully exiting..."
                );

                process.exit(1);
            }, 10000).unref();

            server.close(async () => {
                try {
                    await mongoose.connection.close();
                    console.log("MongoDB connection closed");

                    if (redisClient.isOpen) {
                        await redisClient.quit();
                        console.log("Redis connection closed");
                    }

                    console.log("Server shut down successfully");

                    process.exit(0);
                } catch (error) {
                    console.error(
                        "Error during graceful shutdown:",
                        error.message
                    );

                    process.exit(1);
                }
            });
        };

        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));
    } catch (error) {
        console.error("Failed to start server:", error.message);
        process.exit(1);
    }
};
startServer();
