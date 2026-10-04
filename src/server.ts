import cron from "node-cron";
import { createApp } from "./app.js";
import { syncAll } from "./sync.js";

cron.schedule(process.env.SYNC_CRON ?? "0 6 * * *", () => { syncAll().catch((e) => console.error(String(e))); });

const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, "0.0.0.0", () => console.log(`http://localhost:${port}`));
