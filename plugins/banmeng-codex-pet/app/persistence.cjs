const fs = require("node:fs");
const path = require("node:path");

function parseJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonWithBackup(filePath) {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    try {
      return parseJsonFile(candidate);
    } catch {}
  }
  return null;
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const backupPath = `${filePath}.bak`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
  try {
    try {
      parseJsonFile(filePath);
      fs.copyFileSync(filePath, backupPath);
    } catch {}
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try { fs.unlinkSync(temporaryPath); } catch {}
  }
}

module.exports = { readJsonWithBackup, writeJsonAtomic };
