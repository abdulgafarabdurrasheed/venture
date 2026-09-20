import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// npm workspace runs with cwd in server/; load monorepo root .env, then server/.env overrides.
dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, ".env") });

export function getDefaultDevEmail() {
	const configuredEmail =
		process.env.DEV_USER_EMAIL?.trim() || process.env.SUPERADMIN_EMAILS?.split(",")[0]?.trim();

	return configuredEmail || ["dev", "localhost"].join("@");
}
