const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

async function unlockSecurely() {
    console.log("Upserting default settings record to ensure unlock...");
    const { data, error } = await supabase
        .from('system_settings')
        .upsert({ id: 'default', inventory_closed_until: null }, { onConflict: 'id' })
        .select();

    if (error) {
        console.error("Error upserting settings:", error.message);
        if (error.message.includes("policy")) {
            console.log("NOTE: This might be due to RLS policies. The user should use the UI under an Admin account to unlock.");
        }
    } else {
        console.log("Settings updated successfully:", data);
    }
}

unlockSecurely();
