// mongoAuthState.js
const { useMultiFileAuthState } = require("@whiskeysockets/baileys");
const fs = require("fs-extra");
const path = require("path");
const tar = require("tar");
const { connectDb } = require("./db");

const AUTH_DIR = "./auth_info";
const STORE_FILE = "./store.json";
const AUTH_TAR = "auth_backup.tar"; // Changed name for clarity

async function useMongoAuthState() {
    let db;
    try {
        db = await connectDb();
    } catch (error) {
        console.error("❌ Failed to connect to MongoDB:", error);
        throw new Error("Database connection failed");
    }
    
    const coll = db.collection("auth");

    // Ensure local auth directory exists
    await fs.ensureDir(AUTH_DIR);

    // Restore session from MongoDB
    let session;
    try {
        session = await coll.findOne({ _id: "session" });
    } catch (error) {
        console.error("❌ Failed to query MongoDB session:", error);
        session = null;
    }

    const archiveBuffer = session?.archive?.buffer || session?.archive;

    if (archiveBuffer && Buffer.isBuffer(archiveBuffer)) {
        try {
            // Write archive to file
            await fs.writeFile(AUTH_TAR, archiveBuffer);
            
            // Extract archive
            await tar.x({ file: AUTH_TAR, C: ".", strict: true });

            // Verify auth files were extracted
            const credsPath = path.join(AUTH_DIR, "creds.json");
            if (await fs.pathExists(credsPath)) {
                console.log("✅ Session restored successfully from MongoDB.");
                
                // Verify store.json integrity if it exists
                if (await fs.pathExists(STORE_FILE)) {
                    try {
                        const storeData = await fs.readJson(STORE_FILE);
                        const chatCount = Object.keys(storeData.chats || {}).length;
                        const contactCount = Object.keys(storeData.contacts || {}).length;
                        console.log(`✅ Store data restored: ${chatCount} chats, ${contactCount} contacts`);
                    } catch (err) {
                        console.warn("⚠️ Store file corrupted, removing...");
                        await fs.remove(STORE_FILE);
                    }
                }
            } else {
                console.warn("⚠️ Session archive extracted but creds.json missing. Clearing session.");
                await cleanupSession(coll);
            }
        } catch (err) {
            console.error("❌ Failed to restore session from MongoDB:", err);
            await cleanupSession(coll);
        } finally {
            // Clean up temporary archive file
            await fs.remove(AUTH_TAR).catch(() => {});
        }
    } else {
        console.log("ℹ️ No existing session found in DB. A new QR/pairing code will be generated.");
    }

    // Generate Baileys multi-file auth state
    let state, originalSaveCreds;
    try {
        ({ state, saveCreds: originalSaveCreds } = await useMultiFileAuthState(AUTH_DIR));
    } catch (error) {
        console.error("❌ Failed to initialize multi-file auth state:", error);
        throw error;
    }

    // Save all auth files AND store.json to MongoDB
    async function saveCreds() {
        try {
            // Save Baileys credentials first
            await originalSaveCreds();

            // Prepare files to backup
            const filesToBackup = [AUTH_DIR];
            
            // Include store.json if it exists
            if (await fs.pathExists(STORE_FILE)) {
                filesToBackup.push(STORE_FILE);
            }

            // Create archive of all files
            await tar.c({ 
                file: AUTH_TAR, 
                cwd: ".", 
                portable: true,
                gzip: false // Faster, smaller files work fine
            }, filesToBackup);

            // Read the archive
            const data = await fs.readFile(AUTH_TAR);

            // Save to MongoDB
            await coll.updateOne(
                { _id: "session" },
                { 
                    $set: { 
                        archive: data, 
                        timestamp: new Date(),
                        size: data.length
                    }
                },
                { upsert: true }
            );

            // Clean up temporary archive
            await fs.remove(AUTH_TAR);
            console.log("💾 Session and store saved to MongoDB.");
            
        } catch (error) {
            console.error("❌ Failed to save session to MongoDB:", error);
            // Don't throw - we don't want to crash the app for backup failures
        }
    }

    // Helper function to clean up corrupted session
    async function cleanupSession(collection) {
        try {
            await collection.deleteOne({ _id: "session" });
            await fs.emptyDir(AUTH_DIR);
            await fs.remove(STORE_FILE).catch(() => {});
            console.log("🧹 Session cleanup completed.");
        } catch (cleanupError) {
            console.error("❌ Failed to cleanup session:", cleanupError);
        }
    }

    return { state, saveCreds };
}

module.exports = { useMongoAuthState };
