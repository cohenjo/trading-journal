import { createClient } from '@supabase/supabase-js';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase URL or Key");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase
    .from('finance_snapshots')
    .select('data')
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error("Error:", error);
    return;
  }

  const items = data.data.items || [];
  console.log(`Found ${items.length} items`);
  let trueTotal = 0;
  let forcedTotal = 0;
  for (const item of items) {
    console.log(item.name, item.category, item.type, item.value, item.currency);
    let val = item.value;
    if (item.currency === 'USD') {
        trueTotal += val * 3.8;
        forcedTotal += val; // what if currency dropdown was left on ILS
    } else {
        trueTotal += val;
        forcedTotal += val;
    }
  }
  console.log('True Total ILS:', trueTotal);
  console.log('Forced Total ILS:', forcedTotal);
}

main();
