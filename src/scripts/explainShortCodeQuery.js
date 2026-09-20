require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Url = require("../models/url.model");

const run = async () => {
    try {
        await connectDB();

        console.log("\n===== INDEXED QUERY =====");

        const indexResult = await Url.findOne({
            shortCode: "GWeLzvjZ56l86O4v",
        }).explain("executionStats");

        console.dir(indexResult, {
            depth: null,
            colors: true,
        });

        console.log("\n===== NON-INDEXED QUERY =====");

        const collectionResult = await Url.findOne({
            originalUrl:
                "https://shop.example.com/collections/womens-trail-running-shoes/products/gtx-trail-runner-v3?variant=42910229381&utm_source=instagram&utm_medium=paid-social&utm_campaign=spring-2026-launch&utm_content=carousel-frame-2&utm_term=trail-running&gclid=Cj0KCQjw3ZC2BhDBARIsAOEZ",
        }).explain("executionStats");

        console.dir(collectionResult, {
            depth: null,
            colors: true,
        });
    } catch (error) {
        console.error("Error:", error);
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close();
        console.log("\nMongoDB connection closed.");
    }
};

run();