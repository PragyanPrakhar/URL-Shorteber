const Url = require("../models/url.model");
const generateShortCode = require("../utils/generateShortCode");

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
    const url = await Url.findOne({ shortUrl: shortCode });
    return url;
};

module.exports = {
    createShortUrl,
    getUrlByShortCode,
};
