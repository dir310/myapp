const Jimp = require("jimp");
const fs = require("fs");

async function convertIcons() {
  try {
    const icon192Path = "./public/icons/icon-192x192.png";
    const icon512Path = "./public/icons/icon-512x512.png";

    // Re-read file to force actual PNG write
    const img1 = await Jimp.read(icon192Path);
    await img1.writeAsync(icon192Path);
    console.log("Converted 192x192 successfully to true PNG");

    const img2 = await Jimp.read(icon512Path);
    await img2.writeAsync(icon512Path);
    console.log("Converted 512x512 successfully to true PNG");

  } catch (err) {
    console.error("Error converting images:", err);
  }
}

convertIcons();
