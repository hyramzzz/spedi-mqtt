"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const supabase_js_1 = require("@supabase/supabase-js");
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SUPERUSER_EMAIL;
const password = process.env.SUPERUSER_PASSWORD;
if (!supabaseUrl || !serviceRoleKey || !email || !password) {
    console.error('Missing environment variables. Ensure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPERUSER_EMAIL, and SUPERUSER_PASSWORD are set.');
    process.exit(1);
}
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, serviceRoleKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
async function seedSuperuser() {
    console.log(`Seeding superuser: ${email}...`);
    try {
        // 1. Check if user already exists in auth.users
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        if (listError)
            throw listError;
        let user = users.find(u => u.email === email);
        if (!user) {
            console.log('User not found in Auth, creating...');
            const { data: { user: newUser }, error: createError } = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true
            });
            if (createError)
                throw createError;
            user = newUser;
            console.log('Auth user created successfully.');
        }
        else {
            console.log('User already exists in Auth, updating password...');
            const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
                password
            });
            if (updateError)
                throw updateError;
        }
        // 2. Ensure record exists in public.users with is_superuser = true
        // This will trigger the sync_superuser_status postgres function we created earlier
        console.log('Ensuring record in public.users...');
        const { error: upsertError } = await supabase
            .from('users')
            .upsert({
            id: user.id,
            email: user.email,
            is_superuser: true
        }, { onConflict: 'id' });
        if (upsertError)
            throw upsertError;
        console.log('Superuser seed completed successfully!');
    }
    catch (error) {
        console.error('Error seeding superuser:', error);
        process.exit(1);
    }
}
seedSuperuser();
