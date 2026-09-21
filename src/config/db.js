const mongoose = require("mongoose");

mongoose.connection.on("connected", () => {
    console.log("MongoDB connection established");
});

mongoose.connection.on("error", (error) => {
    console.error("MongoDB runtime connection error:", error);
});

mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected");
});

mongoose.connection.on("reconnected", () => {
    console.log("MongoDB reconnected successfully");
});

const connectDB = async () => {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
        throw new Error("MONGODB_URI environment variable is not defined");
    }

    try {
        await mongoose.connect(uri, {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            autoIndex: process.env.NODE_ENV !== "production",
        });

        console.log("MongoDB connected successfully");
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        throw error;
    }
};

module.exports = connectDB;