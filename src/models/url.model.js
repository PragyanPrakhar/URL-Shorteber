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
urlSchema.index({ shortUrl: 1 }, { unique: true });
const urlModel = mongoose.model("Url", urlSchema);
module.exports = urlModel;
