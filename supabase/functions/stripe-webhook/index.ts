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

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function updateCompanySubscription(
  companyId: string,
  status: string,
  plan: string,
  stripeCustomerId?: string,
  stripeSubscriptionId?: string,
  currentPeriodEnd?: string
) {
  const updates: Record<string, unknown> = {
    subscription_status: status,
    subscription_plan: plan,
  };
  if (stripeCustomerId) updates.stripe_customer_id = stripeCustomerId;
  if (stripeSubscriptionId) updates.stripe_subscription_id = stripeSubscriptionId;
  if (currentPeriodEnd) updates.current_period_end = currentPeriodEnd;
  if (status === "active") updates.trial_ends_at = null;

  await supabaseAdmin.from("companies").update(updates).eq("id", companyId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
      return new Response(
        JSON.stringify({ error: "Missing stripe-signature" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const companyId = session.metadata?.company_id;
        if (companyId && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            session.subscription as string
          );
          const interval = sub.items.data[0]?.price?.recurring?.interval;
          const plan = interval === "year" ? "annual" : "monthly";
          await updateCompanySubscription(
            companyId,
            "active",
            plan,
            session.customer as string,
            session.subscription as string,
            new Date(sub.current_period_end * 1000).toISOString()
          );
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const companyId = sub.metadata?.company_id;
        if (companyId) {
          const statusMap: Record<string, string> = {
            active: "active",
            past_due: "past_due",
            canceled: "canceled",
            unpaid: "unpaid",
            trialing: "trialing",
          };
          const interval = sub.items.data[0]?.price?.recurring?.interval;
          const plan = interval === "year" ? "annual" : "monthly";
          await updateCompanySubscription(
            companyId,
            statusMap[sub.status] || sub.status,
            plan,
            sub.customer as string,
            sub.id,
            new Date(sub.current_period_end * 1000).toISOString()
          );
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const companyId = sub.metadata?.company_id;
        if (companyId) {
          await updateCompanySubscription(companyId, "canceled", "none");
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.subscription;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId as string);
          const companyId = sub.metadata?.company_id;
          if (companyId) {
            await updateCompanySubscription(
              companyId,
              "past_due",
              sub.items.data[0]?.price?.recurring?.interval === "year"
                ? "annual"
                : "monthly"
            );
          }
        }
        break;
      }
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
