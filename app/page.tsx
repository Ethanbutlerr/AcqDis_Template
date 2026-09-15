'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight, CheckCircle2, MessageSquare, BarChart3,
  Users, Building2, Phone, Target,
  TrendingUp, Shield, Mail, ChevronDown,
} from 'lucide-react';

function useInView(threshold = 0.1) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function FadeIn({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useInView();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export default function LandingPage() {
  const { user, loading, profile } = useAuth();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [handlingAuth, setHandlingAuth] = useState(false);

  // Immediate check for auth hash fragments (recovery tokens, etc.)
  // This must run before anything else renders
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      // Supabase implicit flow puts tokens in the hash: #access_token=...&type=recovery
      if (hash.includes('type=recovery')) {
        setHandlingAuth(true);
        // Let Supabase client process the hash, then redirect
        supabase.auth.getSession().then(() => {
          router.replace('/reset-password');
        });
        return;
      }
      if (hash.includes('type=signup') || hash.includes('type=magiclink') || hash.includes('access_token=')) {
        setHandlingAuth(true);
        supabase.auth.getSession().then(() => {
          router.replace('/dashboard');
        });
        return;
      }
    }
    // Also check for PKCE code in query params
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      setHandlingAuth(true);
      const type = params.get('type');
      supabase.auth.exchangeCodeForSession(code).then(() => {
        if (type === 'recovery') {
          router.replace('/reset-password');
        } else {
          router.replace('/dashboard');
        }
      });
      return;
    }
  }, [router]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!loading && user && profile && !profile.is_disabled) {
      router.replace('/dashboard');
    }
  }, [user, loading, profile, router]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/reset-password');
      }
    });
    return () => { subscription.unsubscribe(); };
  }, [router]);

  if (handlingAuth) return null;
  if (!loading && user && profile && !profile.is_disabled) return null;

  return (
    <div className="min-h-screen bg-[#090909] text-white antialiased selection:bg-[#F084F0]/30">
      {/* NAV */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-[#090909]/90 backdrop-blur-xl border-b border-white/[0.06]'
          : 'bg-transparent'
      }`}>
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/ChatGPT_Image_Jul_31,_2026,_02_12_00_PM.png"
              alt="AcqDis"
              width={32}
              height={32}
              className="h-8 w-8 object-contain"
              priority
            />
            <span className="font-bold text-lg tracking-tight">AcqDis</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm">
            <a href="#product" className="text-white/50 hover:text-white transition-colors">Product</a>
            <a href="#pricing" className="text-white/50 hover:text-white transition-colors">Pricing</a>
            <Link href="/login" className="text-white/50 hover:text-white transition-colors">Sign in</Link>
            <Link
              href="/signup"
              className="px-4 py-2 rounded-lg bg-[#F084F0] text-[#110711] text-sm font-semibold hover:bg-[#F084F0]/90 active:scale-95 transition-all"
            >
              Start free trial
            </Link>
          </div>
          <div className="md:hidden flex items-center gap-4">
            <Link href="/login" className="text-sm text-white/60 py-2">Sign in</Link>
            <Link href="/signup" className="px-4 py-2 rounded-lg bg-[#F084F0] text-[#110711] text-sm font-semibold active:scale-95 transition-transform">
              Start trial
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-24 sm:pt-28 pb-4 sm:pb-6 px-5 sm:px-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[700px] sm:w-[900px] h-[500px] sm:h-[600px] rounded-full bg-[#F084F0]/[0.03] blur-[150px]" />
        </div>

        <div className="max-w-3xl mx-auto text-center space-y-5 sm:space-y-6 relative z-10">
          <h1 className="text-3xl sm:text-5xl lg:text-[3.5rem] font-bold tracking-tight leading-[1.15]">
            The CRM that runs your wholesale operation
          </h1>

          <p className="max-w-lg mx-auto text-[15px] sm:text-lg text-white/45 leading-relaxed px-2">
            Acquisitions, dispositions, SMS campaigns, buyer blasts, and your entire pipeline&mdash;managed from one dashboard instead of six different tools.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
            <Link
              href="/signup"
              className="w-full sm:w-auto px-7 py-3.5 rounded-lg bg-[#F084F0] text-[#110711] font-semibold text-sm hover:bg-[#F084F0]/90 active:scale-[0.97] transition-all flex items-center justify-center gap-2"
            >
              Try it free for 7 days
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#product"
              className="w-full sm:w-auto px-7 py-3.5 rounded-lg border border-white/10 font-medium text-sm hover:bg-white/5 active:bg-white/10 transition-all flex items-center justify-center gap-2 text-white/70"
            >
              See how it works
              <ChevronDown className="h-3.5 w-3.5" />
            </a>
          </div>
          <p className="text-xs text-white/25">No credit card required</p>
        </div>
      </section>

      {/* HERO SCREENSHOT */}
      <section className="px-4 sm:px-6 pb-16 sm:pb-20 pt-6 sm:pt-8">
        <FadeIn className="max-w-5xl mx-auto">
          <div className="relative">
            <div className="absolute -inset-px rounded-xl bg-gradient-to-b from-[#F084F0]/20 via-transparent to-transparent opacity-60 pointer-events-none" />
            <div className="relative rounded-xl border border-white/[0.08] overflow-hidden shadow-2xl shadow-black/60">
              <Image
                src="/demo-dashboard-new.webp"
                alt="AcqDis CRM dashboard"
                width={1600}
                height={900}
                className="w-full block"
                priority
              />
            </div>
          </div>
        </FadeIn>
      </section>

      {/* PRODUCT WALKTHROUGH */}
      <section id="product" className="py-16 sm:py-24 px-5 sm:px-6">
        <div className="max-w-6xl mx-auto space-y-20 sm:space-y-32">

          {/* Acquisitions pipeline */}
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
            <FadeIn>
              <div className="space-y-4">
                <span className="text-[11px] font-medium tracking-widest uppercase text-[#F084F0]/80">Acquisitions</span>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
                  Every seller lead, organized by stage
                </h2>
                <p className="text-white/40 leading-relaxed text-[15px]">
                  Import a skip-traced list and your leads drop into a kanban board&mdash;New Lead, No Answer, Answered, Needs Offer, Under Contract, and whatever custom stages you want. Drag cards between columns, add notes, assign to your team.
                </p>
                <ul className="space-y-2 text-sm text-white/50 pt-1">
                  <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-[#F084F0] mt-0.5 shrink-0" />CSV import with automatic field mapping</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-[#F084F0] mt-0.5 shrink-0" />Custom pipeline stages per company</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-[#F084F0] mt-0.5 shrink-0" />Filter by source, motivation, and assignment</li>
                </ul>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <div className="relative rounded-xl border border-white/[0.08] overflow-hidden shadow-2xl shadow-black/50">
                <Image
                  src="/demo-pipeline-new.webp"
                  alt="Acquisitions pipeline"
                  width={1600}
                  height={900}
                  className="w-full block"
                  loading="lazy"
                />
              </div>
            </FadeIn>
          </div>

          {/* Conversations */}
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
            <FadeIn delay={100} className="order-2 lg:order-2">
              <div className="space-y-4">
                <span className="text-[11px] font-medium tracking-widest uppercase text-[#F084F0]/80">Conversations</span>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
                  SMS and email in one thread
                </h2>
                <p className="text-white/40 leading-relaxed text-[15px]">
                  No more switching between your phone, Gmail, and a spreadsheet. Every text and email with a seller or buyer lives in one timeline, tied to their contact record.
                </p>
                <ul className="space-y-2 text-sm text-white/50 pt-1">
                  <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-[#F084F0] mt-0.5 shrink-0" />A2P / 10DLC compliant messaging</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-[#F084F0] mt-0.5 shrink-0" />Automatic opt-out handling</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-[#F084F0] mt-0.5 shrink-0" />Attachment support for photos and docs</li>
                </ul>
              </div>
            </FadeIn>
            <FadeIn className="order-1 lg:order-1">
              <div className="relative rounded-xl border border-white/[0.08] overflow-hidden shadow-2xl shadow-black/50">
                <Image
                  src="/demo-conversations-new.webp"
                  alt="Conversations inbox"
                  width={1600}
                  height={900}
                  className="w-full block"
                  loading="lazy"
                />
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* FEATURE GRID */}
      <section className="py-16 sm:py-20 px-5 sm:px-6 border-y border-white/[0.04] bg-[#070507]">
        <div className="max-w-6xl mx-auto">
          <FadeIn>
            <p className="text-center text-[11px] font-medium tracking-widest uppercase text-[#F084F0]/80 mb-2">What&apos;s included</p>
            <h2 className="text-center text-2xl sm:text-3xl font-bold tracking-tight mb-10 sm:mb-14">
              One subscription, zero feature gates
            </h2>
          </FadeIn>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.04] rounded-xl overflow-hidden border border-white/[0.04]">
            {[
              { icon: Target, title: 'Seller pipeline', desc: 'Import lists, build stages, assign leads, track every deal from first touch to closing.' },
              { icon: MessageSquare, title: 'SMS campaigns', desc: 'Drip sequences and one-off blasts. TCPA-compliant with opt-out tracking built in.' },
              { icon: Mail, title: 'Email', desc: 'Transactional and bulk email with open tracking and full attachment support.' },
              { icon: TrendingUp, title: 'Disposition board', desc: 'Manage your dispo side\u2014match buyers, send contracts, coordinate closings.' },
              { icon: Users, title: 'Buyer blasts', desc: 'Upload your buyer list and blast new deals. Track opens, replies, and interest.' },
              { icon: BarChart3, title: 'Dashboard & KPIs', desc: 'Revenue, response rates, pipeline velocity, conversion ratios\u2014all live.' },
              { icon: Shield, title: 'Roles & permissions', desc: 'Control who sees what. Admin, acquisitions manager, cold caller\u2014your call.' },
              { icon: Building2, title: 'Multi-company', desc: 'Agency mode with sub-accounts. Switch between companies like GoHighLevel.' },
              { icon: Phone, title: 'Built-in Twilio', desc: 'SMS and voice through your account. No separate Twilio setup to get started.' },
            ].map((f) => (
              <div key={f.title} className="bg-[#090909] p-5 sm:p-7">
                <f.icon className="h-5 w-5 text-[#F084F0]/70 mb-3" />
                <h3 className="font-semibold text-sm mb-1.5 text-white">{f.title}</h3>
                <p className="text-[13px] text-white/35 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-16 sm:py-24 px-5 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <FadeIn>
            <p className="text-center text-[11px] font-medium tracking-widest uppercase text-[#F084F0]/80 mb-2">Pricing</p>
            <h2 className="text-center text-2xl sm:text-3xl font-bold tracking-tight mb-2">
              Flat rate. Every feature included.
            </h2>
            <p className="text-center text-white/35 mb-10 sm:mb-14 max-w-sm mx-auto text-sm">
              You only pay extra for SMS/email volume&mdash;the platform fee covers everything else.
            </p>
          </FadeIn>

          <div className="grid sm:grid-cols-2 gap-4 sm:gap-5 max-w-2xl mx-auto mb-10 sm:mb-14">
            {/* Monthly */}
            <FadeIn>
              <div className="rounded-xl border border-white/[0.08] bg-[#0a060a] p-6 sm:p-7 space-y-4 h-full flex flex-col">
                <div>
                  <h3 className="font-semibold text-white">Monthly</h3>
                  <p className="text-xs text-white/30 mt-0.5">Cancel anytime</p>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white">$15</span>
                  <span className="text-white/30 text-sm">/mo</span>
                </div>
                <ul className="space-y-2 text-sm flex-1">
                  {['Unlimited contacts & leads', 'SMS & email campaigns', 'Acquisitions + dispositions', 'Buyer blasts', 'Team roles & permissions', 'Agency sub-accounts'].map((item) => (
                    <li key={item} className="flex items-center gap-2 text-white/55">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#F084F0]/70 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className="block w-full text-center px-6 py-3 rounded-lg border border-white/10 font-medium text-sm hover:bg-white/5 active:bg-white/10 transition-all text-white/70">
                  Start free trial
                </Link>
              </div>
            </FadeIn>

            {/* Annual */}
            <FadeIn delay={80}>
              <div className="rounded-xl border border-[#F084F0]/25 bg-[#0a060a] p-6 sm:p-7 space-y-4 relative h-full flex flex-col">
                <div className="absolute -top-2.5 right-5 px-2.5 py-0.5 rounded-full bg-[#F084F0] text-[#110711] text-[10px] font-bold tracking-wide">
                  SAVE $80
                </div>
                <div>
                  <h3 className="font-semibold text-white">Annual</h3>
                  <p className="text-xs text-white/30 mt-0.5">~$8.33/mo, billed yearly</p>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white">$100</span>
                  <span className="text-white/30 text-sm">/yr</span>
                </div>
                <ul className="space-y-2 text-sm flex-1">
                  {['Everything in monthly', 'Priority support', 'Rate locked for 12 months', 'Best price per month'].map((item) => (
                    <li key={item} className="flex items-center gap-2 text-white/55">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#F084F0]/70 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className="block w-full text-center px-6 py-3 rounded-lg bg-[#F084F0] text-[#110711] font-semibold text-sm hover:bg-[#F084F0]/90 active:scale-[0.97] transition-all">
                  Start free trial
                </Link>
              </div>
            </FadeIn>
          </div>

          {/* Usage rates */}
          <FadeIn>
            <div className="max-w-2xl mx-auto rounded-xl border border-white/[0.06] bg-[#070507] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/[0.06]">
                <h3 className="font-semibold text-sm text-white">Usage-based rates</h3>
                <p className="text-[11px] text-white/30 mt-0.5">Billed through AcqDis. No separate Twilio or Resend account needed.</p>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {[
                  { service: 'SMS (send/receive)', rate: '$0.01125/segment' },
                  { service: 'MMS outbound', rate: '$0.03/message' },
                  { service: 'MMS inbound', rate: '$0.015/message' },
                  { service: 'Phone number', rate: '$1.50/mo' },
                  { service: '10DLC registration', rate: '$15 one-time' },
                  { service: 'Email', rate: '$0.0015/email' },
                ].map((row) => (
                  <div key={row.service} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span className="text-white/50">{row.service}</span>
                    <span className="font-mono text-white/40 text-xs">{row.rate}</span>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 sm:py-20 px-5 sm:px-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[400px] h-[250px] rounded-full bg-[#F084F0]/[0.04] blur-[100px]" />
        </div>
        <FadeIn className="max-w-2xl mx-auto text-center space-y-5 relative z-10">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Stop duct-taping tools together</h2>
          <p className="text-white/35 text-sm sm:text-base">
            7-day free trial. Set up in under 5 minutes.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-lg bg-[#F084F0] text-[#110711] font-semibold text-sm hover:bg-[#F084F0]/90 active:scale-[0.97] transition-all"
          >
            Get started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </FadeIn>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/[0.04] py-8 px-5 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Image
              src="/ChatGPT_Image_Jul_31,_2026,_02_12_00_PM.png"
              alt="AcqDis"
              width={24}
              height={24}
              className="h-6 w-6 object-contain"
            />
            <span className="font-semibold text-sm">AcqDis</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-white/30">
            <a href="#product" className="hover:text-white/60 transition-colors py-1">Product</a>
            <a href="#pricing" className="hover:text-white/60 transition-colors py-1">Pricing</a>
            <Link href="/login" className="hover:text-white/60 transition-colors py-1">Sign in</Link>
          </div>
          <p className="text-[11px] text-white/15">&copy; {new Date().getFullYear()} Lotus Leads LLC</p>
        </div>
      </footer>
    </div>
  );
}
