const mongoose = require("mongoose");
const urlSchema = new mongoose.Schema(
    {
        originalUrl: {
            type: String,
            required: true,
            trim: true,
        },
        shortUrl: {
            type: String,
            required: true,
            trim: true,
            index:true,
            unique: true,
        },
        clickCount: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    },
);
const urlModel = mongoose.model("Url", urlSchema);
module.exports = urlModel;