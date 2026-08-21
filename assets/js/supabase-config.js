// ======================================================
// Supabase Connection Config
// The "publishable" key below is safe to expose in client-side code —
// it only allows what the Row Level Security policies on the database
// tables permit (see the `resumes` table policies in Supabase).
// Never put the "secret" key here.
// ======================================================

const SUPABASE_URL = 'https://jyotxikfaqfipaaqjufq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_1so89K71w0YvMqbZmglooQ_RHe2Zvun';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
