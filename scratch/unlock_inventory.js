const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load .env.local manually
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const getEnvParam = (key) => {
    const lines = envContent.split('\n');
    for (const line of lines) {
        if (line.startsWith(key + '=')) {
            return line.split('=')[1].trim();
        }
    }
    return '';
};

const supabaseUrl = getEnvParam('NEXT_PUBLIC_SUPABASE_URL');
const supabaseKey = getEnvParam('NEXT_PUBLIC_SUPABASE_ANON_KEY');

const supabase = createClient(supabaseUrl, supabaseKey);

async function unlock() {
    console.log("Checking current lock status...");
    const { data, error: fetchError } = await supabase
        .from('system_settings')
        .select('inventory_closed_until');

    if (fetchError) {
        console.error("Error fetching lock status:", fetchError.message);
        return;
    }

    if (!data || data.length === 0) {
        console.log("No system settings found.");
        return;
    }

    console.log("Current lock status (all rows):", data.map(r => r.inventory_closed_until));

    const lockedRows = data.filter(r => r.inventory_closed_until !== null);

    if (lockedRows.length > 0) {
        console.log("Unlocking system (all rows)...");
        const { error: updateError } = await supabase
            .from('system_settings')
            .update({ inventory_closed_until: null })
            .not('id', 'is', null);

        if (updateError) {
            console.error("Error unlocking system:", updateError.message);
        } else {
            console.log("System unlocked successfully! You can now enter data.");
        }
    } else {
        console.log("System is already unlocked.");
    }
}

unlock();
