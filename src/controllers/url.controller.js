const {
    createShortUrl,
    getUrlByShortCode,
} = require("../services/url.service");

const createUrl = async (req, res) => {
    try {
        const { originalUrl } = req.body;

        if (!originalUrl) {
            return res.status(400).json({
                message: "originalUrl is required",
            });
        }

        const url = await createShortUrl(originalUrl);

        console.log("Short URL created:", url.shortUrl);

        return res.status(201).json({
            shortCode: url.shortCode,
            originalUrl: url.originalUrl,
            createdAt: url.createdAt,
        });
    } catch (error) {
        console.error("Error creating short URL:", error);

        return res.status(500).json({
            message: "Internal server error",
        });
    }
};

const redirectToOriginalUrl = async (req, res) => {
    try {
        const { shortCode } = req.params;

        const url = await getUrlByShortCode(shortCode);

        if (!url) {
            return res.status(404).json({
                message: "Short URL not found",
            });
        }
        console.log(`Redirecting to original URL: ${url.originalUrl} for short code: ${shortCode}`);
        return res.redirect(302, url.originalUrl);
    } catch (error) {
        console.error("Error redirecting:", error);

        return res.status(500).json({
            message: "Internal server error",
        });
    }
};

module.exports = {
    createUrl,
    redirectToOriginalUrl,
};
