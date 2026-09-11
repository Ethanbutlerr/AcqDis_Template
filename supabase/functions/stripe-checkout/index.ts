import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14.21.0";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function getOrCreatePrices() {
  const existingProducts = await stripe.products.list({ limit: 10 });
  let product = existingProducts.data.find(
    (p) => p.metadata?.app === "acqdis"
  );

  if (!product) {
    product = await stripe.products.create({
      name: "AcqDis CRM",
      description: "Complete wholesale real estate CRM",
      metadata: { app: "acqdis" },
    });
  }

  const existingPrices = await stripe.prices.list({
    product: product.id,
    limit: 10,
    active: true,
  });

  let monthlyPrice = existingPrices.data.find(
    (p) =>
      p.recurring?.interval === "month" && p.unit_amount === 1500
  );
  let yearlyPrice = existingPrices.data.find(
    (p) =>
      p.recurring?.interval === "year" && p.unit_amount === 10000
  );

  if (!monthlyPrice) {
    monthlyPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: 1500,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { plan: "monthly" },
    });
  }
  if (!yearlyPrice) {
    yearlyPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: 10000,
      currency: "usd",
      recurring: { interval: "year" },
      metadata: { plan: "annual" },
    });
  }

  return { monthlyPrice, yearlyPrice };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.company_id) {
      return new Response(
        JSON.stringify({ error: "No company found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { plan, success_url, cancel_url } = await req.json();

    const { monthlyPrice, yearlyPrice } = await getOrCreatePrices();
    const priceId = plan === "annual" ? yearlyPrice.id : monthlyPrice.id;

    const customers = await stripe.customers.list({
      email: user.email,
      limit: 1,
    });
    let customerId = customers.data[0]?.id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
          company_id: profile.company_id,
        },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: success_url || `${req.headers.get("origin")}/settings/account?payment=success`,
      cancel_url: cancel_url || `${req.headers.get("origin")}/settings/account?payment=cancelled`,
      metadata: {
        supabase_user_id: user.id,
        company_id: profile.company_id,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          company_id: profile.company_id,
        },
      },
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
