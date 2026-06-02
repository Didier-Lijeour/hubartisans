import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://udotczkordmnvhupnzjf.supabase.co";
const supabaseAnonKey = "sb_publishable_hCw9SawW7CnCFNdqpNXM3A_EoMumxX-";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);