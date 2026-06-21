const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function runExporter() {
  console.log("[WRAPPER] Running decrypter...");
  try {
    const mkPath = path.join(app.getPath("userData"), ".mk");
    if (!fs.existsSync(mkPath)) {
      console.error("[WRAPPER] No .mk file found at:", mkPath);
      return;
    }
    const encryptedKey = fs.readFileSync(mkPath);
    if (!safeStorage.isEncryptionAvailable()) {
      console.error("[WRAPPER] safeStorage not available!");
      return;
    }
    const decryptedKeyHex = safeStorage.decryptString(encryptedKey);
    const key = Buffer.from(decryptedKeyHex, 'hex');

    const Database = require('better-sqlite3');
    
    const dbPath = "/Users/leosaquetto/.antigravity-agent/cloud_accounts.db";
    if (!fs.existsSync(dbPath)) {
      console.error("[WRAPPER] Database not found at:", dbPath);
      return;
    }
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT email, is_active, quota_json FROM accounts").all();
    
    const results = [];
    for (const row of rows) {
      console.log(`[WRAPPER] Row email: ${row.email}, quota_json length: ${row.quota_json ? row.quota_json.length : 'null'}, prefix: ${row.quota_json ? row.quota_json.slice(0, 15) : 'null'}`);
      
      let decryptedQuota = null;
      if (row.quota_json) {
        if (row.quota_json.startsWith("{") || row.quota_json.startsWith("[")) {
          decryptedQuota = row.quota_json;
        } else {
          const Yj = "agm_enc_v1:";
          const cleanStr = row.quota_json.startsWith(Yj) ? row.quota_json.slice(Yj.length) : row.quota_json;
          const parts = cleanStr.split(":");
          console.log(`[WRAPPER] Split parts count: ${parts.length}`);
          if (parts.length === 3) {
            const [ivHex, tagHex, ciphertextHex] = parts;
            const iv = Buffer.from(ivHex, 'hex');
            const tag = Buffer.from(tagHex, 'hex');
            
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            decryptedQuota = decrypted;
            console.log(`[WRAPPER] Decrypted successfully! Length: ${decrypted.length}`);
          }
        }
      }
      results.push({
        email: row.email,
        isActive: row.is_active === 1,
        quota: decryptedQuota ? JSON.parse(decryptedQuota) : null
      });
    }
    
    const targetPath = "/Users/leosaquetto/.antigravity-agent/decrypted_accounts.json";
    fs.writeFileSync(targetPath, JSON.stringify(results, null, 2), "utf8");
    console.log("[WRAPPER] Decrypted accounts written successfully to:", targetPath);
  } catch (err) {
    console.error("[WRAPPER] Decryption error:", err);
  }
}

app.whenReady().then(async () => {
  await runExporter();
  if (process.argv.includes('--export-only')) {
    console.log("[WRAPPER] --export-only argument provided. Quitting.");
    app.quit();
  }
  setInterval(runExporter, 5000 * 60);
});

// Load the original app bundle
require("./main-B--__iEm.js");
