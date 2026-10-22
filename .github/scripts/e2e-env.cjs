const fs = require('node:fs');

const status = JSON.parse(fs.readFileSync(0, 'utf8'));
const url = new URL(status.API_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
  throw new Error('E2E stack must use loopback, never a hosted database');
}
const variables = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
};
for (const [name, value] of Object.entries(variables)) {
  if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) {
    throw new Error(`Missing or invalid local stack value: ${name}`);
  }
}
for (const [name, value] of Object.entries(variables)) {
  console.log(`${name}=${value}`);
}
