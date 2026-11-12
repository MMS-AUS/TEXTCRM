import { loadConfig } from '../config.ts';
import { prepareDevBucket } from '../storage/storage.ts';

// Creates the file bucket (if missing) and allows browser uploads from APP_URL.
// Production runs this once after the first deploy: `docker compose run --rm api node src/cli/prepare-bucket.ts`.
const config = loadConfig();
await prepareDevBucket(config, config.APP_URL);
console.log(`Bucket "${config.S3_BUCKET}" is ready for uploads from ${config.APP_URL}.`);
