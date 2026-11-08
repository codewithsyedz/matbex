import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { buildCorsHeaders } from "../_shared/cors.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

interface CreateUserRequest {
  email: string;
  role: "owner" | "manager" | "cashier" | "accountant";
  tenant_id: string;
  full_name?: string;
  password?: string;
}

// Generate a cryptographically secure random password
const generateSecurePassword = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => chars[byte % chars.length]).join('');
};

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ============================================
    // AUTHENTICATION: Verify caller identity
    // ============================================
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Pass the JWT explicitly to getUser - required when the project
    // uses asymmetric signing keys (the global-header pattern fails silently).
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const supabaseClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Authenticated caller:", caller.email);

    // Create admin client for privileged operations
    const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Parse request body
    const { email, role, tenant_id, full_name, password }: CreateUserRequest = await req.json();

    console.log("Creating user:", email, "for tenant:", tenant_id, "with role:", role);

    if (!email || !tenant_id || !role) {
      throw new Error("Missing required fields: email, tenant_id, role");
    }

    // ============================================
    // AUTHORIZATION: Verify caller permissions
    // ============================================
    
    // Check if caller is SuperAdmin
    const { data: isSuperAdmin } = await supabaseAdmin.rpc('is_superadmin', { 
      _user_id: caller.id 
    });

    // Check if caller is tenant owner
    const { data: isTenantOwner } = await supabaseAdmin.rpc('has_tenant_role', { 
      _user_id: caller.id, 
      _tenant_id: tenant_id, 
      _role: 'owner' 
    });

    if (!isSuperAdmin && !isTenantOwner) {
      return new Response(
        JSON.stringify({ error: "Only SuperAdmins or tenant owners can create users" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Tenant owners cannot create other owners (only SuperAdmins can)
    if (isTenantOwner && !isSuperAdmin && role === 'owner') {
      return new Response(
        JSON.stringify({ error: "Only SuperAdmins can create owner accounts" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Authorization verified for caller:", caller.email);

    // ============================================
    // USER CREATION LOGIC (same as before)
    // ============================================

    // Check if user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === email);

    let userId: string;

    // Use provided password or generate a secure random one
    const userPassword = password || generateSecurePassword();

    if (existingUser) {
      console.log("User already exists:", existingUser.id);
      userId = existingUser.id;

      // Check if user is already in this tenant
      const { data: existingRole } = await supabaseAdmin
        .from("user_tenant_roles")
        .select("id")
        .eq("user_id", userId)
        .eq("tenant_id", tenant_id)
        .maybeSingle();

      if (existingRole) {
        throw new Error("User is already a member of this tenant");
      }

      // Reset password to default for existing user
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: userPassword,
      });

      if (updateError) {
        console.error("Error updating user password:", updateError);
        // Non-fatal, continue
      } else {
        console.log("Password reset to default for existing user");
      }
    } else {
      // Create new user with default password
      
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: userPassword,
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          full_name: full_name || "",
        },
      });

      if (createError) {
        console.error("Error creating user:", createError);
        throw new Error(createError.message);
      }

      console.log("Created new user:", newUser.user.id);
      userId = newUser.user.id;
    }

    // Get primary restaurant for this tenant
    const { data: primaryRestaurant } = await supabaseAdmin
      .from("restaurants")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("is_primary", true)
      .maybeSingle();

    // Add user to tenant roles
    const { error: roleError } = await supabaseAdmin
      .from("user_tenant_roles")
      .insert({
        user_id: userId,
        tenant_id: tenant_id,
        role: role,
      });

    if (roleError) {
      console.error("Error adding tenant role:", roleError);
      throw new Error(roleError.message);
    }

    // Update profile with tenant association
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({
        tenant_id: tenant_id,
        restaurant_id: primaryRestaurant?.id || null,
        full_name: full_name || null,
      })
      .eq("id", userId);

    if (profileError) {
      console.error("Error updating profile:", profileError);
      // Non-fatal error, continue
    }

    // If there's a primary restaurant, also add restaurant-level role
    if (primaryRestaurant) {
      await supabaseAdmin
        .from("user_roles")
        .upsert({
          user_id: userId,
          restaurant_id: primaryRestaurant.id,
          role: role,
        }, {
          onConflict: "user_id,restaurant_id",
          ignoreDuplicates: true,
        });
    }

    console.log(`User ${email} created by ${caller.email} for tenant ${tenant_id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        user_id: userId,
        is_new_user: !existingUser,
        message: existingUser 
          ? "Existing user added to tenant" 
          : "New user created and added to tenant"
      }), 
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error("Error in create-tenant-user function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
