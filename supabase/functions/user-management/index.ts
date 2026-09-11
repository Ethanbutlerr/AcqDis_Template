import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { data: userData, error: authError } =
      await adminClient.auth.getUser(token);
    if (authError || !userData.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const callerId = userData.user.id;

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("company_id, is_disabled")
      .eq("id", callerId)
      .single();

    if (!callerProfile || callerProfile.is_disabled) {
      return jsonResponse({ error: "Account disabled" }, 403);
    }

    const { data: permRows } = await adminClient
      .from("user_roles")
      .select("role_id")
      .eq("user_id", callerId);

    const roleIds = (permRows ?? []).map((r) => r.role_id);
    let permKeys: string[] = [];

    if (roleIds.length > 0) {
      const { data: rpData } = await adminClient
        .from("role_permissions")
        .select("permission_id")
        .in("role_id", roleIds);

      const permIds = (rpData ?? []).map((rp) => rp.permission_id);
      if (permIds.length > 0) {
        const { data: permData } = await adminClient
          .from("permissions")
          .select("key")
          .in("id", permIds);
        permKeys = (permData ?? []).map((p) => p.key);
      }
    }

    const hasPerm = (key: string) => permKeys.includes(key);

    const url = new URL(req.url);
    const path = url.pathname
      .replace("/functions/v1/user-management", "")
      .replace("/user-management", "");
    const method = req.method;

    if (method === "POST" && path === "/create") {
      if (!hasPerm("manage_users")) {
        return jsonResponse({ error: "Insufficient permissions" }, 403);
      }

      const body = await req.json();
      const { email, full_name, role_id, team_id } = body;

      if (!email || !full_name) {
        return jsonResponse({ error: "Email and full name are required" }, 400);
      }

      const createOrigin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/[^/]*$/, "") || "";

      // Use inviteUserByEmail: creates user + sends invite in one call, no rate limit
      const { data: newAuthUser, error: createError } =
        await adminClient.auth.admin.inviteUserByEmail(email, {
          data: { full_name },
          redirectTo: `${createOrigin}/auth/callback?type=recovery`,
        });

      if (createError) {
        return jsonResponse({ error: createError.message }, 400);
      }

      const newUserId = newAuthUser.user.id;

      await adminClient.from("profiles").insert({
        id: newUserId,
        company_id: callerProfile.company_id,
        email,
        full_name,
      });

      if (role_id) {
        await adminClient.from("user_roles").insert({
          user_id: newUserId,
          role_id,
        });
      }

      if (team_id) {
        await adminClient.from("team_members").insert({
          team_id,
          user_id: newUserId,
          role: "member",
        });
      }

      await adminClient.from("audit_logs").insert({
        user_id: callerId,
        action: "user_created",
        entity_type: "user",
        entity_id: newUserId,
        metadata: { email, full_name, role_id, team_id },
      });

      return jsonResponse({ success: true, user_id: newUserId });
    }

    if (method === "POST" && path === "/disable") {
      if (!hasPerm("manage_users")) {
        return jsonResponse({ error: "Insufficient permissions" }, 403);
      }

      const body = await req.json();
      const { user_id, disabled } = body;

      if (!user_id) {
        return jsonResponse({ error: "User ID is required" }, 400);
      }

      if (user_id === callerId) {
        return jsonResponse({ error: "Cannot disable your own account" }, 400);
      }

      await adminClient.from("profiles").update({
        is_disabled: disabled,
      }).eq("id", user_id);

      if (disabled) {
        await adminClient.auth.admin.updateUserById(user_id, {
          ban_duration: "87600h",
        });
      } else {
        await adminClient.auth.admin.updateUserById(user_id, {
          ban_duration: "none",
        });
      }

      await adminClient.from("audit_logs").insert({
        user_id: callerId,
        action: disabled ? "user_disabled" : "user_enabled",
        entity_type: "user",
        entity_id: user_id,
        metadata: {},
      });

      return jsonResponse({ success: true });
    }

    if (method === "POST" && path === "/reset-password") {
      if (!hasPerm("manage_users")) {
        return jsonResponse({ error: "Insufficient permissions" }, 403);
      }

      const body = await req.json();
      const { email } = body;

      if (!email) {
        return jsonResponse({ error: "Email is required" }, 400);
      }

      const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/[^/]*$/, "") || "";

      // Use admin.generateLink to bypass Supabase's 60s rate limit
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${origin}/auth/callback?type=recovery` },
      });

      if (linkError) {
        return jsonResponse({ error: linkError.message }, 400);
      }

      const actionLink = linkData?.properties?.action_link;
      if (!actionLink) {
        return jsonResponse({ error: "Failed to generate reset link" }, 500);
      }

      // Try to send via Resend if configured
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        const { data: profile } = await adminClient.from("profiles")
          .select("company_id").eq("email", email).maybeSingle();
        let fromEmail = "noreply@acqdis.com";
        let fromName = "AcqDis";
        if (profile?.company_id) {
          const { data: company } = await adminClient.from("companies")
            .select("from_email, from_email_name, name").eq("id", profile.company_id).maybeSingle();
          if (company?.from_email) fromEmail = company.from_email;
          if (company?.from_email_name) fromName = company.from_email_name;
          else if (company?.name) fromName = company.name;
        }

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `${fromName} <${fromEmail}>`,
            to: email,
            subject: "Set your password",
            html: `<p>Click the link below to set your password:</p><p><a href="${actionLink}">Set Password</a></p><p>This link expires in 24 hours.</p>`,
          }),
        });
      } else {
        // No Resend key, try resetPasswordForEmail as fallback (may hit rate limit)
        await adminClient.auth.resetPasswordForEmail(email, {
          redirectTo: `${origin}/auth/callback?type=recovery`,
        });
      }

      return jsonResponse({ success: true });
    }

    if (method === "POST" && path === "/delete") {
      if (!hasPerm("manage_users")) {
        return jsonResponse({ error: "Insufficient permissions" }, 403);
      }

      const body = await req.json();
      const { user_id } = body;

      if (!user_id) {
        return jsonResponse({ error: "User ID is required" }, 400);
      }

      if (user_id === callerId) {
        return jsonResponse({ error: "Cannot delete your own account" }, 400);
      }

      // Delete profile (cascades to user_roles, team_members)
      await adminClient.from("profiles").delete().eq("id", user_id);

      // Delete auth user
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(user_id);
      if (deleteError) {
        return jsonResponse({ error: deleteError.message }, 400);
      }

      await adminClient.from("audit_logs").insert({
        user_id: callerId,
        action: "user_deleted",
        entity_type: "user",
        entity_id: user_id,
        metadata: {},
      });

      return jsonResponse({ success: true });
    }

    if (method === "POST" && path === "/update-last-login") {
      await adminClient.from("profiles").update({
        last_login_at: new Date().toISOString(),
      }).eq("id", callerId);

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Not found" }, 404);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500,
    );
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
