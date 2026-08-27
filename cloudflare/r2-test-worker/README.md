# DBY POS R2 staging worker

This worker is deliberately isolated from production data. It only accepts objects under the `test/` prefix and is intended for the Admin `R2 Storage Test Lab` tab.

## First-time setup

```powershell
cd cloudflare/r2-test-worker
npm install
npx wrangler login
npx wrangler r2 bucket create dby-pos-test
npx wrangler secret put R2_TEST_KEY
npx wrangler deploy
```

Use a long random value for `R2_TEST_KEY`. Enter the deployed `workers.dev` URL and the same key in the app's Admin test tab. Do not commit the key or put it in the desktop build.

## Test API

- `GET /health` checks the Worker without credentials.
- `GET /objects` lists staging objects.
- `POST /objects/:key` uploads a file (maximum 15 MB).
- `GET /objects/:key` downloads a private object through the Worker.
- `DELETE /objects/:key` deletes a test object.

The desktop app does not use this Worker for business uploads until the Test Lab passes. Existing Google Drive flows remain the default during the canary phase.
