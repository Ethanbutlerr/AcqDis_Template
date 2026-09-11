'use client';

import Link from 'next/link';
import Image from 'next/image';

export function AuthLayout({
  children,
  title,
  subtitle,
  hideBackLink,
}: {
  children: React.ReactNode;
  title: string;
  subtitle: string;
  hideBackLink?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[#090909] lg:grid lg:grid-cols-2">
      {/* Left panel -- branding */}
      <div className="hidden lg:flex lg:flex-col lg:justify-between bg-[#0a060a] border-r border-white/5 p-12 text-white">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/ChatGPT_Image_Jul_31,_2026,_02_12_00_PM.png"
            alt="AcqDis logo"
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 object-contain"
          />
          <span className="text-lg font-semibold tracking-tight">AcqDis</span>
        </Link>

        <div className="space-y-5">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Wholesale real estate,{' '}
            <span className="text-[#F084F0]">simplified.</span>
          </h1>
          <p className="text-white/50 text-base max-w-md leading-relaxed">
            The complete CRM for acquisitions, dispositions, and transaction
            coordination. Manage your entire wholesale pipeline from one dashboard.
          </p>
        </div>

        <div className="text-xs text-white/25 tracking-wide">
          &copy; {new Date().getFullYear()} Lotus Leads LLC
        </div>
      </div>

      {/* Right panel -- form */}
      <div className="flex flex-1 flex-col items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile logo */}
          <Link href="/" className="lg:hidden flex items-center justify-center gap-3 mb-2">
            <Image
              src="/ChatGPT_Image_Jul_31,_2026,_02_12_00_PM.png"
              alt="AcqDis logo"
              width={36}
              height={36}
              className="h-9 w-9 shrink-0 object-contain"
            />
            <span className="text-base font-semibold tracking-tight">AcqDis</span>
          </Link>

          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>

          {children}

          {!hideBackLink && (
            <div className="text-center text-xs text-muted-foreground">
              <Link href="/login" className="hover:text-foreground transition-colors">
                Back to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
