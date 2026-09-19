const ALPHABET =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const BASE = BigInt(ALPHABET.length);
// A MongoDB ObjectId is 12 bytes = 96 bits.

const generateShortCode = (objectId) => {
    const hex = objectId.toHexString();

    // ObjectId is 12 bytes = 24 hexadecimal characters.
    // Convert the hex representation into a BigInt.
    let number = BigInt(`0x${hex}`);

    if (number === 0n) {
        return ALPHABET[0];
    }

    let shortCode = "";

    while (number > 0n) {
        const remainder = number % BASE;

        shortCode = ALPHABET[Number(remainder)] + shortCode;

        number = number / BASE;
    }

    return shortCode;
};

module.exports = generateShortCode;
