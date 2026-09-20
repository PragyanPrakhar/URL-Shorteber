require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("./config/db");
const app = require("./app");
const {connectRedis , redisClient}=require("./config/redis");

const PORT = process.env.PORT || 3000;

const startServer = async () => {
    await connectDB();
    await connectRedis();

    const server = app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });

    const shutdown = async (signal) => {
        console.log(`${signal} received. Shutting down gracefully...`);

        server.close(async () => {
            await mongoose.connection.close();

            console.log("MongoDB connection closed");
            console.log("Server shut down successfully");

            process.exit(0);
        });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
};

startServer();
