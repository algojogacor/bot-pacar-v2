const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState } = require("@whiskeysockets/baileys");

async function start() {
    console.log("📡 Starting JID Finder...");

    const { state, saveCreds } = await useMultiFileAuthState('./auth_jid');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ["Chrome", "Desktop", "1.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection } = update;

        if (connection === "open") {
            console.log("\n🔥 JID kamu:");
            console.log("➡️  " + sock.user.id);
            process.exit(0);
        }

        if (connection === "close") {
            console.log("❌ Koneksi ditutup");
            process.exit(1);
        }
    });
}

start();