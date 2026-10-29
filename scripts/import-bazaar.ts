// Imports x402 resources from facilitator discovery ("Bazaar") endpoints and groups them into projects by host.
// Usage: npm run db:import [-- --dry-run] [-- --max=5000]
import "./env";
import { importBazaar } from "../src/lib/bazaar-import";

const args = process.argv.slice(2);
const summary = await importBazaar({
  dryRun: args.includes("--dry-run"),
  max: Number(args.find((a) => a.startsWith("--max="))?.split("=")[1] ?? Infinity),
});
console.log(summary.written ? "Import complete." : "Dry run complete.", summary);
process.exit(0);
