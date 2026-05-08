'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowUp,
  ArrowRight,
  Activity,
  AlertTriangle,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  Circle,
  Coffee,
  Database,
  FileUp,
  FlaskConical,
  MessageSquareText,
  Minus,
  PanelBottomOpen,
  Radio,
  RefreshCw,
  Sparkles,
  Target,
  UploadCloud,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { AnimateOnView } from '@/components/AnimateOnView';
import AppSidebar from '@/components/AppSidebar';
import { Badge } from '@/components/ui/badge';
import { BorderBeam } from '@/components/ui/border-beam';
import { Button } from '@/components/ui/button';
import { NumberTicker } from '@/components/ui/number-ticker';
import { Separator } from '@/components/ui/separator';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge as UntitledBadge, BadgeWithDot as UntitledBadgeWithDot } from '@/components/untitled/base/badges/badges';
import { Button as UntitledButton } from '@/components/untitled/base/buttons/button';
import { ProgressBarBase as UntitledProgressBarBase } from '@/components/untitled/base/progress-indicators/progress-indicators';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

const LaserFlow = dynamic(() => import('@/components/LaserFlow').then((mod) => mod.LaserFlow), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[radial-gradient(circle_at_50%_100%,rgba(12,205,205,0.18),transparent_42%)]" />,
});

const MagicRings = dynamic(() => import('@/components/MagicRings'), {
  ssr: false,
  loading: () => <div className="h-full w-full rounded-full bg-[radial-gradient(circle,rgba(12,205,205,0.18),transparent_58%)]" />,
});

const GradualBlur = dynamic(() => import('@/components/GradualBlur'), {
  ssr: false,
  loading: () => null,
});

const ShapeBlur = dynamic(() => import('@/components/ShapeBlur'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[radial-gradient(circle,rgba(255,255,255,0.12),transparent_58%)]" />,
});

const Iridescence = dynamic(() => import('@/components/Iridescence'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[radial-gradient(circle_at_50%_50%,rgba(12,205,205,0.18),transparent_48%)]" />,
});

const SoftAurora = dynamic(() => import('@/components/SoftAurora'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[radial-gradient(circle_at_50%_10%,rgba(216,255,251,0.32),transparent_42%)]" />,
});

type PanelState = 'closed' | 'open' | 'submitting' | 'success';
type BackgroundMode = 'clinical' | 'signal' | 'dark';
type FontPairingId = 'manrope-inter' | 'manrope-poppins' | 'manrope-manrope' | 'manrope-jakarta';

interface MagicBorderBeamProps {
  className?: string;
  duration?: number;
  delay?: number;
  reverse?: boolean;
  active?: boolean;
  size?: number;
}

function MagicBorderBeam({ className, duration = 7, delay = 0, reverse = false, active = true, size = 180 }: MagicBorderBeamProps) {
  return (
    <BorderBeam
      duration={duration}
      delay={delay}
      reverse={reverse}
      size={size}
      borderWidth={2}
      colorFrom="#d8fffb"
      colorTo="#00a4b4"
      className={cn(active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100', className)}
    />
  );
}

function MagicShimmerLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className="group block"
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 430, damping: 28 }}
    >
      <ShimmerButton
        type="button"
        shimmerColor="#d8fffb"
        shimmerSize="0.08em"
        shimmerDuration="2.2s"
        background="var(--magic-bg, #0d3547)"
        className={cn('w-full justify-between border-cyan-100/20 px-4 py-0 shadow-none', className)}
        onClick={() => {
          window.location.href = href;
        }}
      >
        <span className="relative z-10 flex w-full items-center justify-between gap-2">{children}</span>
      </ShimmerButton>
    </motion.div>
  );
}

const prompts = [
  'Explain the strongest signal in this cohort.',
  'Which accounts should I review first?',
  'Draft a calm morning workflow for my GTM base.',
];

const todayTasks = [
  { label: 'Review accounts with new buying signals', icon: Activity, status: 'Live' },
  { label: 'Prioritise contacts at high-fit companies', icon: Target, status: '12 ready' },
  { label: 'Check import health before outreach', icon: Database, status: '2 warnings' },
  { label: 'Ask Qlaus for the shortest next move', icon: Bot, status: 'Suggested' },
];

const signalCards = [
  { label: 'Fit movement', value: '+18%', tone: 'bg-cyan-50 text-arcova-teal' },
  { label: 'Fresh contacts', value: '42', tone: 'bg-slate-100 text-[#0d3547]' },
  { label: 'Risk cleared', value: '3', tone: 'bg-emerald-50 text-emerald-700' },
];

const fontPairings: Array<{
  id: FontPairingId;
  name: string;
  displayClassName: string;
  bodyClassName: string;
  note: string;
}> = [
  {
    id: 'manrope-inter',
    name: 'Manrope + Inter',
    displayClassName: 'font-manrope',
    bodyClassName: 'font-inter',
    note: 'My leading pick: premium headers with crisp, effortless product text.',
  },
  {
    id: 'manrope-poppins',
    name: 'Manrope + Poppins',
    displayClassName: 'font-manrope',
    bodyClassName: 'font-poppins',
    note: 'Keeps today’s friendly softness, but makes headers feel more grown up.',
  },
  {
    id: 'manrope-manrope',
    name: 'Manrope only',
    displayClassName: 'font-manrope',
    bodyClassName: 'font-manrope',
    note: 'Very cohesive and polished, though body copy can feel a touch broad.',
  },
  {
    id: 'manrope-jakarta',
    name: 'Manrope + Jakarta',
    displayClassName: 'font-manrope',
    bodyClassName: 'font-jakarta',
    note: 'Beautiful and boutique, but possibly too styled for dense GTM workflows.',
  },
];

const todayMockAgenda = [
  {
    title: 'Signal movement cluster',
    detail: '8 accounts changed across funding, hiring, and positioning.',
    href: '/leads/accounts?agentTask=signal_movement',
    icon: Activity,
    meta: 'Start here',
  },
  {
    title: 'Northstar Bio coverage',
    detail: 'High fit account, thin buying team coverage.',
    href: '/leads/health?focus=contact-depth',
    icon: Users,
    meta: 'Fix gap',
  },
  {
    title: 'Latest import review',
    detail: '42 ready contacts, 3 source checks before outreach.',
    href: '/import?from=today',
    icon: FileUp,
    meta: 'Quick pass',
  },
];

function SignalOrb({ active, size = 'h-7 w-7' }: { active?: boolean; size?: string }) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full border border-white/50 bg-[#0d3547] shadow-sm',
        size,
      )}
      aria-hidden
    >
      <span className="absolute inset-[5px] rounded-full bg-[radial-gradient(circle_at_35%_30%,#d8fffb_0%,#64ece5_28%,#0ccdcc_58%,#0d3547_100%)]" />
      <span
        className={cn(
          'absolute h-[2px] w-3/5 rounded-full bg-white/85 shadow-[0_0_10px_rgba(216,255,251,0.8)]',
          active && 'animate-pulse',
        )}
      />
    </span>
  );
}

function TodayViewMockup() {
  const motionEase = [0.22, 1, 0.36, 1] as const;
  const containerMotion = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.05,
      },
    },
  };
  const riseMotion = {
    hidden: { opacity: 0, y: 18 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.68, ease: motionEase },
    },
  };

  return (
    <motion.section
      className="relative overflow-hidden rounded-[32px] border border-slate-200 bg-[#f8fafb] shadow-sm"
      variants={containerMotion}
      initial="hidden"
      animate="show"
    >
      <style jsx>{`
        @keyframes today-border-flow {
          to {
            transform: translateX(180%);
          }
        }

        @keyframes today-float {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-6px);
          }
        }

        @keyframes agent-lab-shimmer {
          0% {
            background-position: 180% 0;
          }
          100% {
            background-position: -180% 0;
          }
        }

        .today-float {
          animation: today-float 4.5s ease-in-out infinite;
        }

        .today-shine::after {
          content: "";
          position: absolute;
          inset-block: 0;
          left: -45%;
          width: 38%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.78), transparent);
          opacity: 0;
          transition: opacity 180ms ease;
        }

        .today-shine:hover::after {
          opacity: 1;
          animation: today-border-flow 900ms ease-out;
        }

        @media (prefers-reduced-motion: reduce) {
          .today-float,
          .today-shine:hover::after {
            animation: none;
          }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(12,205,205,0.16),transparent_26%),linear-gradient(90deg,rgba(13,53,71,0.025)_1px,transparent_1px)] bg-[size:auto,56px_56px]" />

      <div className="relative grid gap-0 xl:grid-cols-[minmax(0,1fr)_360px]">
        <motion.div className="min-w-0 p-6 sm:p-8" variants={riseMotion}>
          <div className="flex flex-col gap-5 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-100 bg-white/82 px-3 py-1 text-xs font-semibold text-arcova-teal shadow-sm">
                <Coffee className="h-3.5 w-3.5" />
                Daily briefing
              </div>
              <h2 className="mt-4 text-4xl font-semibold tracking-normal text-slate-950 sm:text-5xl">
                Good morning, Emma
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                Three things are worth your attention. Everything else can wait.
              </p>
            </div>

            <MagicShimmerLink
              href="/briefing?ask=qlaus"
              className="inline-flex h-11 shrink-0 items-center rounded-full bg-[#0d3547] px-4 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(13,53,71,0.18)]"
            >
              <SignalOrb active size="h-6 w-6" />
              Ask Qlaus
              <ArrowRight className="h-4 w-4" />
            </MagicShimmerLink>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="space-y-3">
              {todayMockAgenda.map(({ title, detail, href, icon: Icon, meta }, index) => (
                <motion.a
                  key={title}
                  href={href}
                  className={cn(
                    'group relative grid min-h-[88px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 overflow-hidden rounded-[22px] border bg-white/88 px-4 py-3 shadow-[0_10px_28px_rgba(13,53,71,0.06)] transition-all duration-300 hover:border-cyan-200 hover:bg-white',
                    index === 0 ? 'border-cyan-200 shadow-[0_16px_42px_rgba(12,205,205,0.12)]' : 'border-slate-200',
                  )}
                  variants={riseMotion}
                  whileHover={{ y: -3, scale: 1.004 }}
                  whileTap={{ scale: 0.992 }}
                  transition={{ type: 'spring', stiffness: 430, damping: 30 }}
                >
                  {index === 0 ? (
                    <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_50%,rgba(12,205,205,0.12),transparent_34%)] opacity-80 transition-opacity duration-300 group-hover:opacity-100" />
                  ) : null}
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-100 bg-cyan-50 text-arcova-teal shadow-sm transition-transform duration-300 group-hover:scale-105">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-base font-semibold tracking-normal text-slate-800">{title}</span>
                      {index === 0 ? (
                        <UntitledBadge type="pill-color" color="brand" size="sm" className="hidden sm:inline-flex">
                          recommended
                        </UntitledBadge>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-sm text-slate-500">{detail}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 md:inline-flex">
                      {meta}
                    </span>
                    <ArrowRight className="h-4 w-4 text-slate-300 transition-all duration-300 group-hover:translate-x-1 group-hover:text-arcova-teal" />
                  </span>
                </motion.a>
              ))}
            </div>

            <motion.div
              className="rounded-[24px] border border-cyan-100 bg-white/74 p-4 shadow-[0_12px_30px_rgba(13,53,71,0.06)]"
              variants={riseMotion}
              whileHover={{ y: -3 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#0d3547]">Today at a glance</p>
                <Sparkles className="h-4 w-4 text-arcova-teal" />
              </div>
              <div className="mt-4 space-y-3">
                {[
                  { label: 'Ready leads', value: '42', href: '/leads/contacts?status=ready' },
                  { label: 'Coverage gaps', value: '2', href: '/leads/health' },
                  { label: 'Live jobs', value: '1', href: '/leads/data' },
                ].map((metric, index) => (
                  <a
                    key={metric.label}
                    href={metric.href}
                    className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3 transition-colors hover:border-cyan-200"
                  >
                    <span className="text-xs font-medium text-slate-500">{metric.label}</span>
                    <NumberTicker
                      value={Number(metric.value)}
                      delay={index * 0.12}
                      className="text-xl font-semibold tracking-normal text-[#0d3547]"
                    />
                  </a>
                ))}
              </div>
            </motion.div>
          </div>
        </motion.div>

        <motion.aside
          className="relative overflow-hidden border-t border-slate-200/80 bg-[#0d3547] p-6 text-white xl:border-l xl:border-t-0"
          variants={riseMotion}
        >
          <MagicBorderBeam duration={8} delay={1.2} reverse className="opacity-70" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Qlaus read</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-normal text-white">Start with the cluster.</h3>
            </div>
            <motion.div
              animate={{ y: [0, -6, 0], rotate: [0, 1.5, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <SignalOrb active size="h-12 w-12" />
            </motion.div>
          </div>

          <div className="mt-7 space-y-3">
            {[
              'The strongest motion is in funded biotech accounts.',
              'Two accounts are worth reviewing before new outreach.',
              'The import is ready enough to work today.',
            ].map((item, index) => (
              <motion.div
                key={item}
                variants={riseMotion}
                whileHover={{ x: 3 }}
                transition={{ type: 'spring', stiffness: 360, damping: 32 }}
              >
                <div className="rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 text-sm leading-6 text-white/76 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  {item}
                </div>
              </motion.div>
            ))}
          </div>

          <MagicShimmerLink
            href="/briefing?agentTask=suggest_start"
            className="mt-7 flex h-12 items-center justify-between rounded-full bg-white px-4 text-sm font-semibold text-[#0d3547] shadow-[0_18px_46px_rgba(0,0,0,0.18)]"
          >
            <span>Suggest the first move</span>
            <ArrowUp className="h-4 w-4" />
          </MagicShimmerLink>
        </motion.aside>
      </div>
    </motion.section>
  );
}

function MagicUiInstalledStrip() {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <div className="relative min-h-36 overflow-hidden rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <BorderBeam size={160} duration={4} borderWidth={2} colorFrom="#d8fffb" colorTo="#00a4b4" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Magic UI</p>
          <h3 className="mt-2 text-lg font-semibold text-slate-950">Border Beam</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">Actual perimeter beam component.</p>
        </div>
      </div>

      <div className="flex min-h-36 flex-col justify-between rounded-[24px] border border-slate-200 bg-[#0d3547] p-5 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Magic UI</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Shimmer Button</h3>
        </div>
        <ShimmerButton
          shimmerColor="#d8fffb"
          shimmerSize="0.08em"
          shimmerDuration="2.2s"
          background="#0d3547"
          className="h-11 w-full border-cyan-100/20 px-4 text-sm"
        >
          Ask Qlaus
        </ShimmerButton>
      </div>

      <div className="min-h-36 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Magic UI</p>
        <h3 className="mt-2 text-lg font-semibold text-slate-950">Number Ticker</h3>
        <p className="mt-4 text-4xl font-semibold text-[#0d3547]">
          <NumberTicker value={42} />
        </p>
      </div>
    </section>
  );
}

function LandingBackgroundCandidates() {
  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
          <Sparkles className="h-3.5 w-3.5" />
          Landing background candidates
        </div>
        <h2 className="font-manrope text-3xl font-semibold tracking-normal text-slate-950">
          Saved React Bits backgrounds for marketing pages
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-slate-500">
          These are not product-app surfaces. They are stored here as landing/hero atmosphere candidates.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="relative min-h-[420px] overflow-hidden rounded-[32px] border border-white/40 bg-[#f8fbfd] shadow-sm">
          <div className="absolute inset-0">
            <Iridescence color={[0.55, 0.98, 0.94]} speed={0.65} amplitude={0.08} mouseReact />
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(248,251,253,0.88),rgba(248,251,253,0.50)_48%,rgba(248,251,253,0.18))]" />
          <div className="relative z-10 flex min-h-[420px] flex-col justify-end p-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Iridescence</p>
            <h3 className="mt-2 max-w-md font-manrope text-4xl font-semibold tracking-normal text-slate-950">
              Premium motion for a public hero.
            </h3>
            <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
              Gorgeous, but a little expressive. Best for the landing page, not Today or account workflows.
            </p>
          </div>
        </div>

        <div className="relative min-h-[420px] overflow-hidden rounded-[32px] border border-cyan-100 bg-[#071f2b] shadow-sm">
          <div className="absolute inset-0 opacity-90">
            <SoftAurora
              speed={0.34}
              scale={1.15}
              brightness={1.15}
              color1="#d8fffb"
              color2="#00A4B4"
              bandHeight={0.54}
              bandSpread={0.78}
              noiseFrequency={2.1}
              enableMouseInteraction
              mouseInfluence={0.12}
            />
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,31,43,0.14),rgba(7,31,43,0.74)_72%,#071f2b)]" />
          <div className="relative z-10 flex min-h-[420px] flex-col justify-end p-8 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Soft Aurora</p>
            <h3 className="mt-2 max-w-md font-manrope text-4xl font-semibold tracking-normal text-white">
              Calmer brand atmosphere.
            </h3>
            <p className="mt-3 max-w-md text-sm leading-6 text-white/64">
              More Arcova-compatible than Iridescence. This could become a tasteful landing-page hero backdrop.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function UntitledUiInstalledStrip() {
  return (
    <section className="grid gap-4 lg:grid-cols-[1.1fr_1fr_1fr]">
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Official Untitled UI</p>
        <h3 className="mt-2 text-lg font-semibold text-slate-950">Base components, Arcova tokens</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          These are source components from untitleduico/react, with their required color tokens mapped to our palette.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <UntitledBadgeWithDot type="pill-color" color="success" size="sm">
            Active
          </UntitledBadgeWithDot>
          <UntitledBadge type="pill-color" color="brand" size="sm">
            Recommended
          </UntitledBadge>
          <UntitledBadge type="pill-color" color="gray" size="sm">
            Neutral
          </UntitledBadge>
        </div>
      </div>

      <div className="rounded-[24px] border border-slate-200 bg-[#f8fafb] p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Untitled button</p>
        <h3 className="mt-2 text-lg font-semibold text-slate-950">Real React Aria button</h3>
        <UntitledButton
          href="/briefing?from=agent-lab"
          size="md"
          color="primary"
          iconTrailing={ArrowRight}
          className="mt-5 rounded-full"
        >
          Open briefing
        </UntitledButton>
      </div>

      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Untitled progress</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-950">Quiet enrichment state</h3>
          </div>
          <span className="text-sm font-semibold text-[#0d3547]">68%</span>
        </div>
        <div className="mt-6">
          <UntitledProgressBarBase value={68} />
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-500">A calmer base for the app’s long enrichment waits.</p>
      </div>
    </section>
  );
}

function ReactBitsMotionStudy() {
  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
          <Sparkles className="h-3.5 w-3.5" />
          React Bits
        </div>
        <h2 className="text-3xl font-semibold tracking-normal text-slate-950">Motion for moments that should feel alive</h2>
        <p className="max-w-2xl text-sm leading-6 text-slate-500">
          These are official React Bits registry components. I’d use them for enrichment, agent thinking, and rare “Qlaus is working” moments.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="relative min-h-[420px] overflow-hidden rounded-[30px] border border-white/10 bg-[#071f2b] p-6 text-white shadow-sm">
          <div className="pointer-events-none absolute inset-0 opacity-95">
            <LaserFlow
              color="#d8fffb"
              horizontalBeamOffset={0.5}
              verticalBeamOffset={0.6}
              horizontalSizing={1.2}
              verticalSizing={1.25}
              flowSpeed={0.45}
              fogIntensity={0.22}
              fogScale={0.2}
              wispIntensity={4.2}
              wispDensity={1}
              flowStrength={0.42}
              falloffStart={1.7}
              mouseTiltStrength={0.012}
            />
          </div>
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(7,31,43,0.92)_0%,rgba(7,31,43,0.62)_26%,rgba(7,31,43,0.16)_58%,rgba(7,31,43,0.56)_100%)]" />
          <svg className="pointer-events-none absolute inset-x-8 bottom-24 z-[1] h-24 text-cyan-100/50" viewBox="0 0 620 96" fill="none" aria-hidden>
            <path className="agent-lab-dash" d="M312 12 C286 54 160 50 70 78" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="8 10" />
            <path className="agent-lab-dash" d="M312 12 C320 56 314 58 310 82" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="8 10" />
            <path className="agent-lab-dash" d="M312 12 C342 54 464 50 550 78" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="8 10" />
          </svg>
          <div className="relative z-10 flex h-full min-h-[372px] flex-col">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Laser Flow</p>
                <h3 className="mt-2 max-w-md text-3xl font-semibold tracking-normal text-white">
                  Enrichment should look like signal, not a spinner.
                </h3>
              </div>
              <UntitledBadgeWithDot type="pill-color" color="brand" size="sm" className="border-white/10 bg-white/10 text-cyan-50 ring-white/10">
                Reading
              </UntitledBadgeWithDot>
            </div>

            <div className="relative z-10 mt-auto grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Accounts', value: '12' },
                { label: 'Contacts', value: '42' },
                { label: 'Signals', value: '8' },
              ].map((item, index) => (
                <div key={item.label} className="rounded-2xl border border-cyan-100/25 bg-white/[0.09] p-4 shadow-[0_0_34px_rgba(216,255,251,0.10)] backdrop-blur-md">
                  <p className="text-xs font-medium text-white/54">{item.label}</p>
                  <p className="mt-3 text-2xl font-semibold text-white">
                    <NumberTicker value={Number(item.value)} delay={index * 0.12} />
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative min-h-[420px] overflow-hidden rounded-[30px] border border-white/10 bg-[#071f2b] p-6 text-white shadow-sm">
          <div className="absolute left-1/2 top-1/2 h-[390px] w-[390px] -translate-x-1/2 -translate-y-1/2 opacity-95">
            <MagicRings
              color="#ffffff"
              colorTwo="#d8fffb"
              ringCount={6}
              speed={0.62}
              attenuation={7.2}
              lineThickness={2.4}
              baseRadius={0.2}
              radiusStep={0.09}
              scaleRate={0.2}
              opacity={0.86}
              noiseAmount={0.025}
              rotation={22}
              followMouse
              mouseInfluence={0.1}
              hoverScale={1.1}
              parallax={0.045}
              clickBurst
            />
          </div>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,rgba(216,255,251,0.12),transparent_38%),linear-gradient(180deg,rgba(7,31,43,0.10),#071f2b_92%)]" />
          <div className="relative z-10 flex min-h-[372px] flex-col items-center justify-center text-center">
            <SignalOrb active size="h-16 w-16" />
            <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-cyan-200">Magic Rings</p>
            <h3 className="mt-2 max-w-sm text-3xl font-semibold tracking-normal text-white">
              A gorgeous Qlaus thinking state.
            </h3>
            <p className="mt-3 max-w-sm text-sm leading-6 text-white/62">
              This feels right around the agent orb, especially when Qlaus is clustering signals or preparing a recommendation.
            </p>
            <MagicShimmerLink
              href="/briefing?react-bits=magic-rings"
              className="mt-7 inline-flex h-11 w-auto min-w-48 rounded-full bg-[#0d3547] px-4 text-sm font-semibold text-white"
            >
              Try thinking state
              <ArrowRight className="h-4 w-4" />
            </MagicShimmerLink>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="relative min-h-[360px] overflow-hidden rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="relative z-10">
            <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Gradual Blur</p>
            <h3 className="mt-2 max-w-md text-2xl font-semibold tracking-normal text-slate-950">
              Softer scroll edges for dense work surfaces.
            </h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
              This is a better version of fade masks for panels, chat history, and long enrichment logs.
            </p>
          </div>

          <div className="relative mt-6 h-52 overflow-hidden rounded-[24px] border border-slate-200 bg-[#f8fafb] p-3">
            <div className="space-y-2">
              {[
                'Resolved 12 target accounts',
                'Matched 42 contacts to buying-team roles',
                'Read funding and hiring signal evidence',
                'Checked source confidence before outreach',
                'Prepared a short Qlaus recommendation',
              ].map((item, index) => (
                <div key={item} className="flex items-center gap-3 rounded-2xl border border-white bg-white/86 px-3 py-3 shadow-sm">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-50 text-xs font-semibold text-arcova-teal">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium text-slate-700">{item}</span>
                </div>
              ))}
            </div>
            <GradualBlur
              position="bottom"
              height="6rem"
              strength={2.8}
              divCount={8}
              curve="bezier"
              opacity={1}
              zIndex={30}
              className="rounded-b-[24px]"
            />
          </div>
        </div>

        <div className="relative min-h-[360px] overflow-hidden rounded-[30px] border border-white/10 bg-[#071f2b] p-6 text-white shadow-sm">
          <div className="absolute inset-0 opacity-70">
            <ShapeBlur
              variation={0}
              shapeSize={1.08}
              roundness={0.34}
              borderSize={0.045}
              circleSize={0.36}
              circleEdge={0.5}
              className="opacity-80"
            />
          </div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(12,205,205,0.20),transparent_34%),linear-gradient(180deg,rgba(7,31,43,0.18),#071f2b_88%)]" />
          <div className="relative z-10 flex min-h-[312px] flex-col">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Shape Blur</p>
            <h3 className="mt-2 max-w-md text-2xl font-semibold tracking-normal text-white">
              A more mysterious agent synthesis state.
            </h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/62">
              This feels useful when Qlaus is not just loading, but transforming a fuzzy evidence set into a clear shape.
            </p>
            <div className="mt-auto flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-md">
              <span className="text-sm font-semibold text-white">Synthesizing signal shape</span>
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-100 [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-100 [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-100" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FontSelectionStudy() {
  const [selectedPairingId, setSelectedPairingId] = useState<FontPairingId>('manrope-jakarta');
  const selectedPairing = fontPairings.find((font) => font.id === selectedPairingId) ?? fontPairings[0];

  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-0 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="border-b border-slate-200 bg-[#f8fafb] p-6 xl:border-b-0 xl:border-r">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
            <Sparkles className="h-3.5 w-3.5" />
            Font study
          </div>
          <p className="mt-2 font-manrope text-2xl font-semibold tracking-normal text-slate-950">Choose the Arcova voice</p>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Manrope feels right for H1s and section headers. This lets us test what should carry paragraphs, rows, labels, and app chrome.
          </p>

          <div className="mt-5 grid gap-2">
            {fontPairings.map((font) => (
              <button
                key={font.id}
                type="button"
                onClick={() => setSelectedPairingId(font.id)}
                className={cn(
                  'group rounded-2xl border px-4 py-3 text-left transition-all duration-300 hover:-translate-y-0.5',
                  selectedPairingId === font.id
                    ? 'border-cyan-200 bg-cyan-50/80 shadow-[0_14px_34px_rgba(12,205,205,0.12)]'
                    : 'border-slate-200 bg-white hover:border-cyan-200',
                )}
              >
                <span className={cn('block text-lg font-semibold tracking-normal text-[#0d3547]', font.displayClassName)}>
                  {font.name}
                </span>
                <span className={cn('mt-1 block text-xs leading-5 text-slate-500', font.bodyClassName)}>{font.note}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={cn('p-6 sm:p-8', selectedPairing.bodyClassName)}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">{selectedPairing.name}</p>
              <p className={cn('mt-2 text-4xl font-semibold tracking-normal text-slate-950 sm:text-5xl', selectedPairing.displayClassName)}>
                Good morning, Emma
              </p>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
                Qlaus has pulled together the smallest useful set of work for today.
              </p>
            </div>
            <MagicShimmerLink
              href="/briefing?font-study=true"
              className="inline-flex h-11 shrink-0 items-center rounded-full bg-[#0d3547] px-4 text-sm font-semibold text-white"
            >
              Ask Qlaus
              <ArrowRight className="h-4 w-4" />
            </MagicShimmerLink>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <div className="relative min-h-36 overflow-hidden rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <BorderBeam size={150} duration={4.4} borderWidth={2} colorFrom="#d8fffb" colorTo="#00a4b4" />
              <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Magic UI</p>
              <h3 className={cn('mt-2 text-lg font-semibold tracking-normal text-slate-950', selectedPairing.displayClassName)}>
                Border Beam
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                This mirrors the card title style you asked about, but with Manrope applied to the header and the selected body font below.
              </p>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-[#f8fafb] p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Body sample</p>
              <p className={cn('mt-2 text-lg font-semibold tracking-normal text-slate-950', selectedPairing.displayClassName)}>
                Account movement summary
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Funding, hiring, and positioning shifts are clustered across eight accounts. Two are strong enough to review before new outreach.
              </p>
            </div>
          </div>

          <div className="mt-7 grid gap-3">
            {todayMockAgenda.map(({ title, detail, href, icon: Icon, meta }, index) => (
              <motion.a
                key={title}
                href={href}
                className="group grid min-h-[82px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-[22px] border border-slate-200 bg-[#fbfcfd] px-4 py-3 text-left shadow-[0_10px_26px_rgba(13,53,71,0.05)] transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-white"
                whileHover={{ scale: 1.002 }}
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-100 bg-cyan-50 text-arcova-teal">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className={cn('truncate text-base font-semibold tracking-normal text-slate-800', selectedPairing.displayClassName)}>{title}</span>
                    {index === 0 ? (
                      <UntitledBadge type="pill-color" color="brand" size="sm" className="hidden sm:inline-flex">
                        recommended
                      </UntitledBadge>
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-sm text-slate-500">{detail}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 md:inline-flex">
                    {meta}
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-300 transition-all duration-300 group-hover:translate-x-1 group-hover:text-arcova-teal" />
                </span>
              </motion.a>
            ))}
          </div>

          <div className="mt-6 rounded-[24px] border border-cyan-100 bg-cyan-50/50 p-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-[#0d3547]">Ready leads</p>
              <p className="text-3xl font-semibold tabular-nums text-[#0d3547]">
                <NumberTicker value={42} />
              </p>
            </div>
            <UntitledProgressBarBase value={68} className="mt-4 bg-white" />
          </div>
        </div>
      </div>
    </section>
  );
}

function ConnectedTodoStudy() {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-[#f8fafb] p-8 shadow-sm">
      <div className="flex items-center gap-3">
        <SignalOrb active size="h-9 w-9" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Today pattern</p>
          <h3 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">A softer agenda rail</h3>
        </div>
      </div>

      <div className="relative mt-8 max-w-3xl pl-8">
        <div className="absolute left-[11px] top-8 h-[calc(100%-4rem)] w-px border-l border-dashed border-slate-300" />
        <div className="space-y-5">
          {todayTasks.map(({ label, icon: Icon, status }, index) => (
            <button
              key={label}
              type="button"
              className="group relative flex max-w-xl items-center gap-3 rounded-full border border-slate-200 bg-white/92 px-4 py-2.5 text-left shadow-[0_8px_24px_rgba(13,53,71,0.08)] transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-[0_14px_34px_rgba(13,53,71,0.12)]"
            >
              <span className="absolute -left-[31px] top-1/2 h-px w-7 border-t border-dashed border-slate-300 transition-colors group-hover:border-arcova-teal" />
              <span className="absolute -left-[38px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-slate-300 bg-[#f8fafb] transition-colors group-hover:border-arcova-teal group-hover:bg-cyan-50" />
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-100 bg-cyan-50 text-arcova-teal transition-transform duration-300 group-hover:scale-110">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-lg font-medium tracking-normal text-slate-600">
                {label}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                {status}
              </span>
              <ArrowRight className="h-4 w-4 text-slate-300 opacity-0 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function FloatingSignalStudy() {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_15%,rgba(12,205,205,0.12),transparent_30%)]" />
      <div className="relative">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Signal objects</p>
            <h3 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">Tiny pieces of momentum</h3>
          </div>
          <Badge className="rounded-full bg-[#0d3547] text-white hover:bg-[#0d3547]">Motion study</Badge>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {signalCards.map((card, index) => (
            <div
              key={card.label}
              className="group rounded-2xl border border-slate-200 bg-white/86 p-5 shadow-[0_10px_28px_rgba(13,53,71,0.08)] transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_18px_42px_rgba(13,53,71,0.12)]"
              style={{ transitionDelay: `${index * 50}ms` }}
            >
              <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-semibold', card.tone)}>
                {card.label}
              </span>
              <p className="mt-8 text-4xl font-semibold tracking-normal text-[#0d3547]">
                {card.value.startsWith('+') ? '+' : ''}
                <NumberTicker
                  value={Number(card.value.replace(/[^0-9]/g, ''))}
                  delay={index * 0.11}
                  className="text-[#0d3547]"
                />
                {card.value.endsWith('%') ? '%' : ''}
              </p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-2/3 rounded-full bg-arcova-teal transition-all duration-700 group-hover:w-full" />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {['Funding mention', 'Hiring spike', 'New clinical partner', 'Website language changed'].map((label) => (
            <span
              key={label}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-200 hover:text-[#0d3547]"
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function MinimalActionStudy() {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-[#0d3547] p-8 text-white shadow-sm">
      <div className="flex items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Agent affordance</p>
          <h3 className="mt-1 text-2xl font-semibold tracking-normal text-white">One beautiful next action</h3>
        </div>
        <SignalOrb active size="h-10 w-10" />
      </div>

      <div className="mt-8 space-y-3">
        {[
          { label: 'Summarize today', icon: Wand2, done: false },
          { label: '3 accounts need review', icon: Circle, done: false },
          { label: 'Import checks passed', icon: CheckCircle2, done: true },
        ].map(({ label, icon: Icon, done }) => (
          <button
            key={label}
            type="button"
            className="group flex w-full items-center gap-3 rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-left text-sm text-white/78 transition-all duration-300 hover:border-cyan-200/40 hover:bg-white/[0.10]"
          >
            <span className={cn('flex h-8 w-8 items-center justify-center rounded-full', done ? 'bg-cyan-200 text-[#0d3547]' : 'bg-white/10 text-cyan-100')}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="flex-1">{label}</span>
            <span className="text-xs text-white/38 transition-colors group-hover:text-cyan-100">Open</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="group mt-7 flex h-12 w-full items-center justify-between rounded-full bg-white px-4 py-3 text-[#0d3547] shadow-[0_18px_44px_rgba(0,0,0,0.18)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_54px_rgba(0,0,0,0.22)]"
      >
        <span className="flex items-center gap-3 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-arcova-teal" />
          Ask Qlaus what matters
        </span>
        <ArrowUp className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5" />
      </button>
    </div>
  );
}

function ComponentStudies() {
  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
          <Sparkles className="h-3.5 w-3.5" />
          Component studies
        </div>
        <h2 className="text-3xl font-semibold tracking-normal text-slate-950">Beautiful pieces for Today</h2>
        <p className="max-w-2xl text-sm leading-6 text-slate-500">
          A few Arcova-native patterns for replacing square boxes with softer objects, gentle hierarchy, and useful motion.
        </p>
      </div>

      <ConnectedTodoStudy />

      <div className="grid gap-5 xl:grid-cols-2">
        <FloatingSignalStudy />
        <MinimalActionStudy />
      </div>
    </section>
  );
}

function AccountRowStudy() {
  const rows = [
    { name: 'Helix Therapeutics', fit: 94, contacts: 8, signal: 'Funding language changed', tone: 'Ready' },
    { name: 'Northstar Bio', fit: 87, contacts: 3, signal: 'Hiring spike in clinical ops', tone: 'Monitor' },
    { name: 'VectorDx', fit: 76, contacts: 1, signal: 'Coverage gap', tone: 'Source' },
  ];

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Accounts</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">Rows with more tactility</h3>
        </div>
        <Building2 className="h-5 w-5 text-arcova-teal" />
      </div>

      <div className="mt-5 space-y-2">
        {rows.map((row) => (
          <button
            key={row.name}
            type="button"
            className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-2xl border border-slate-200 bg-[#fbfcfd] px-4 py-3 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-white hover:shadow-[0_16px_38px_rgba(13,53,71,0.10)]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-arcova-teal shadow-[0_0_12px_rgba(12,205,205,0.55)]" />
                <p className="truncate text-sm font-semibold text-slate-950">{row.name}</p>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">{row.signal}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-arcova-teal">
                {row.fit}% fit
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                {row.contacts} contacts
              </span>
              <span className="w-16 text-right text-xs font-medium text-slate-400 transition-colors group-hover:text-[#0d3547]">
                {row.tone}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function HealthStateStudy() {
  const dims = [
    { label: 'Coverage', value: 'Good', color: 'bg-emerald-500', detail: '42 matched accounts' },
    { label: 'Contact fit', value: 'Watch', color: 'bg-amber-400', detail: 'Needs seniority depth' },
    { label: 'Depth', value: 'Thin', color: 'bg-rose-500', detail: '1 buying team gap' },
  ];

  return (
    <div className="rounded-[28px] border border-slate-200 bg-[#f8fafb] p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Health</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">Status without harsh tables</h3>
        </div>
        <Activity className="h-5 w-5 text-arcova-teal" />
      </div>

      <div className="mt-5 grid gap-3">
        {dims.map((dim) => (
          <div key={dim.label} className="rounded-2xl border border-white bg-white/84 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className={cn('h-3 w-3 rounded-full shadow-sm', dim.color)} />
                <div>
                  <p className="text-sm font-semibold text-slate-950">{dim.label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{dim.detail}</p>
                </div>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                {dim.value}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportJobStudy() {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Data jobs</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">Progress that feels alive</h3>
        </div>
        <FileUp className="h-5 w-5 text-arcova-teal" />
      </div>

      <div className="mt-5 rounded-2xl border border-cyan-100 bg-cyan-50/50 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-arcova-teal shadow-sm">
              <RefreshCw className="h-4 w-4 animate-spin" />
            </span>
            <div>
              <p className="text-sm font-semibold text-[#0d3547]">Finding contacts at target accounts</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Apollo search running across 12 high-fit companies.</p>
            </div>
          </div>
          <span className="text-sm font-semibold text-arcova-teal">68%</span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
          <div className="relative h-full w-[68%] overflow-hidden rounded-full bg-arcova-teal">
            <div className="absolute inset-y-0 w-16 animate-[arcova-row-glow_1.8s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.78),transparent)]" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalTimelineStudy() {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Signals</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">Compact timeline items</h3>
        </div>
        <Radio className="h-5 w-5 text-arcova-teal" />
      </div>

      <div className="relative mt-5 space-y-4 pl-6">
        <div className="absolute left-2 top-2 h-[calc(100%-1rem)] w-px bg-slate-200" />
        {['Funding round detected', 'Website positioning shifted', 'New VP Clinical hired'].map((item, index) => (
          <div key={item} className="group relative rounded-2xl border border-slate-200 bg-[#fbfcfd] p-4 transition-all duration-300 hover:border-cyan-200 hover:bg-white hover:shadow-sm">
            <span className="absolute -left-[21px] top-5 h-3 w-3 rounded-full border-2 border-white bg-arcova-teal shadow-[0_0_0_4px_rgba(12,205,205,0.12)]" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-950">{item}</p>
                <p className="mt-1 text-xs text-slate-500">{index + 1} account{index === 0 ? 's' : ''} affected</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">Today</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyStateStudy() {
  return (
    <div className="rounded-[28px] border border-dashed border-cyan-200 bg-[radial-gradient(circle_at_50%_0%,rgba(12,205,205,0.12),transparent_36%),#ffffff] p-8 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-50 text-arcova-teal">
        <UploadCloud className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-xl font-semibold text-slate-950">Start with one import</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
        Empty states can feel calm and directional, with one clear action instead of a blank square.
      </p>
      <Button className="mt-5 rounded-full bg-[#0d3547] px-5 text-white hover:bg-[#12465d]">
        Import contacts
      </Button>
    </div>
  );
}

function SetupProgressStudy() {
  const steps = ['Company', 'ICPs', 'Personas', 'Import', 'Signals'];

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Setup</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">A friendlier checklist</h3>
        </div>
        <Users className="h-5 w-5 text-arcova-teal" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {steps.map((step, index) => {
          const complete = index < 3;
          return (
            <div key={step} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-all duration-300',
                  complete
                    ? 'border-cyan-100 bg-cyan-50 text-[#0d3547]'
                    : 'border-slate-200 bg-white text-slate-400',
                )}
              >
                {complete ? <Check className="h-3.5 w-3.5 text-arcova-teal" /> : <Circle className="h-3.5 w-3.5" />}
                {step}
              </span>
              {index < steps.length - 1 ? <span className="hidden h-px w-5 bg-slate-200 sm:block" /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AppSurfaceStudies() {
  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
          <Wand2 className="h-3.5 w-3.5" />
          App surfaces
        </div>
        <h2 className="text-3xl font-semibold tracking-normal text-slate-950">Patterns for the real product</h2>
        <p className="max-w-2xl text-sm leading-6 text-slate-500">
          More examples for existing app components: rows, health states, data jobs, signals, setup, and empty screens.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <AccountRowStudy />
        <HealthStateStudy />
        <ImportJobStudy />
        <SignalTimelineStudy />
        <SetupProgressStudy />
        <EmptyStateStudy />
      </div>
    </section>
  );
}

function EnrichmentOrbitStudy() {
  const nodes = [
    { label: 'Company', angle: '12deg', delay: '0s' },
    { label: 'Signals', angle: '112deg', delay: '-1.2s' },
    { label: 'Contacts', angle: '214deg', delay: '-2.1s' },
  ];

  return (
    <div className="relative min-h-[360px] overflow-hidden rounded-[28px] border border-slate-200 bg-[#071f2b] p-6 text-white shadow-sm">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(12,205,205,0.20),transparent_34%),radial-gradient(circle_at_80%_12%,rgba(216,255,251,0.10),transparent_28%),linear-gradient(90deg,rgba(216,255,251,0.05)_1px,transparent_1px)] bg-[size:auto,auto,52px_52px]" />
      <div className="relative flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Enrichment wait</p>
          <h3 className="mt-1 text-xl font-semibold text-white">Qlaus is triangulating</h3>
        </div>
        <Badge className="rounded-full bg-white/10 text-cyan-100 hover:bg-white/10">Live</Badge>
      </div>

      <div className="relative mx-auto mt-8 flex h-56 w-56 items-center justify-center">
        <div className="absolute inset-0 rounded-full border border-white/10" />
        <div className="absolute inset-8 rounded-full border border-dashed border-cyan-200/24" />
        <div className="agent-lab-orbit absolute inset-2 rounded-full">
          {nodes.map((node) => (
            <div
              key={node.label}
              className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border border-cyan-100/20 bg-white/10 text-[10px] font-semibold text-cyan-50 shadow-[0_12px_34px_rgba(0,0,0,0.24)] backdrop-blur-md"
              style={{
                transform: `rotate(${node.angle}) translateY(-104px) rotate(calc(-1 * ${node.angle}))`,
                animationDelay: node.delay,
              }}
            >
              {node.label}
            </div>
          ))}
        </div>
        <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-cyan-100/25 bg-white/[0.08] shadow-[0_0_70px_rgba(12,205,205,0.22)] backdrop-blur-xl">
          <SignalOrb active size="h-12 w-12" />
        </div>
      </div>

      <p className="relative mx-auto mt-2 max-w-xs text-center text-sm leading-6 text-white/62">
        Checking firmographics, account fit, contact coverage, and signal freshness.
      </p>
    </div>
  );
}

function EnrichmentStageStudy() {
  const stages = [
    { label: 'Resolving companies', icon: Building2, active: false, done: true },
    { label: 'Reading signal evidence', icon: Radio, active: true, done: false },
    { label: 'Scoring buying teams', icon: Users, active: false, done: false },
  ];

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Processing object</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">Beautiful stage stack</h3>
        </div>
        <RefreshCw className="h-5 w-5 animate-spin text-arcova-teal" />
      </div>

      <div className="mt-6 space-y-3">
        {stages.map(({ label, icon: Icon, active, done }) => (
          <div
            key={label}
            className={cn(
              'relative overflow-hidden rounded-2xl border p-4 transition-all duration-500',
              active
                ? 'border-cyan-200 bg-cyan-50/60 shadow-[0_16px_40px_rgba(12,205,205,0.12)]'
                : 'border-slate-200 bg-[#fbfcfd]',
            )}
          >
            {active ? <MagicBorderBeam duration={5.5} size={96} /> : null}
            {active ? (
              <div className="absolute inset-y-0 -left-24 w-24 animate-[arcova-row-glow_1.8s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.86),transparent)]" />
            ) : null}
            <div className="relative flex items-center gap-3">
              <span
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-2xl',
                  done ? 'bg-[#0d3547] text-white' : active ? 'bg-white text-arcova-teal' : 'bg-slate-100 text-slate-400',
                )}
              >
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-950">{label}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {done ? 'Complete' : active ? 'Working now' : 'Queued'}
                </p>
              </div>
              {active ? (
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-arcova-teal [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-arcova-teal [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-arcova-teal" />
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EnrichmentIllustrationStudy() {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-cyan-100 bg-[linear-gradient(135deg,#f8fbfd,#eefafa)] p-6 shadow-sm">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(12,205,205,0.12),transparent_36%),linear-gradient(90deg,rgba(13,53,71,0.035)_1px,transparent_1px)] bg-[size:auto,56px_56px]" />
      <div className="relative flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-arcova-teal">Illustrative wait</p>
          <h3 className="mt-1 text-xl font-semibold text-slate-950">Mapping the market</h3>
        </div>
        <Sparkles className="h-5 w-5 text-arcova-teal" />
      </div>

      <div className="relative mt-8 h-56">
        <div className="absolute left-8 top-10 h-16 w-36 rounded-[28px] border border-slate-200 bg-white/86 p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-950">Target ICP</p>
          <p className="mt-1 text-[11px] text-slate-500">Clinical-stage biotech</p>
        </div>
        <div className="absolute right-8 top-6 h-16 w-36 rounded-[28px] border border-slate-200 bg-white/86 p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-950">New signal</p>
          <p className="mt-1 text-[11px] text-slate-500">Funding and hiring</p>
        </div>
        <div className="absolute bottom-6 left-1/2 h-16 w-40 -translate-x-1/2 rounded-[28px] border border-cyan-100 bg-cyan-50/90 p-4 shadow-sm">
          <p className="text-xs font-semibold text-[#0d3547]">Recommended next step</p>
          <p className="mt-1 text-[11px] text-slate-500">Review 8 accounts</p>
        </div>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 520 224" fill="none" aria-hidden>
          <path className="agent-lab-dash" d="M152 72 C210 84 235 122 260 158" stroke="rgba(12,205,205,0.42)" strokeWidth="2" strokeLinecap="round" strokeDasharray="6 8" />
          <path className="agent-lab-dash" d="M368 68 C310 82 287 121 264 158" stroke="rgba(13,53,71,0.24)" strokeWidth="2" strokeLinecap="round" strokeDasharray="6 8" />
        </svg>
      </div>
    </div>
  );
}

function EnrichmentFailureStudy() {
  return (
    <div className="rounded-[28px] border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-amber-600 shadow-sm">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-950">Enrichment needs a nudge</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            A beautiful waiting system also needs a humane failure state: calm explanation, retry, and a way to keep working.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="rounded-full bg-[#0d3547] text-white hover:bg-[#12465d]">Retry</Button>
            <Button variant="outline" className="rounded-full bg-white">Keep reviewing</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EnrichmentWaitingStudies() {
  return (
    <section className="space-y-5">
      <style jsx>{`
        @keyframes agent-lab-orbit {
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes agent-lab-dash {
          to {
            stroke-dashoffset: -42;
          }
        }

        .agent-lab-orbit {
          animation: agent-lab-orbit 18s linear infinite;
        }

        .agent-lab-dash {
          animation: agent-lab-dash 2.2s linear infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .agent-lab-orbit,
          .agent-lab-dash {
            animation: none;
          }
        }
      `}</style>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
          <RefreshCw className="h-3.5 w-3.5" />
          Enrichment waiting
        </div>
        <h2 className="text-3xl font-semibold tracking-normal text-slate-950">Make waiting feel intelligent</h2>
        <p className="max-w-2xl text-sm leading-6 text-slate-500">
          The app has long-running enrichment moments. These studies turn “loading” into visible progress, context, and trust.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <EnrichmentOrbitStudy />
        <EnrichmentStageStudy />
        <EnrichmentIllustrationStudy />
        <EnrichmentFailureStudy />
      </div>
    </section>
  );
}

function AgentComposer({
  state,
  setState,
}: {
  state: PanelState;
  setState: (state: PanelState) => void;
}) {
  const [value, setValue] = useState('');
  const [hoverPosition, setHoverPosition] = useState({ x: 50, y: 50 });
  const isOpen = state !== 'closed';
  const isSubmitting = state === 'submitting';
  const isSuccess = state === 'success';

  const submitMock = () => {
    if (!value.trim() || isSubmitting) return;
    setState('submitting');
    window.setTimeout(() => {
      setState('success');
      window.setTimeout(() => setState('open'), 1200);
    }, 900);
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverPosition({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="relative flex min-h-[620px] items-end justify-center">
        <div
          onMouseMove={handleMouseMove}
          className={cn(
            'group relative overflow-visible border bg-white/92 shadow-[0_24px_80px_rgba(13,53,71,0.16)] backdrop-blur-xl transition-all duration-500 ease-out',
            isOpen
              ? 'h-[520px] w-[420px] rounded-[24px]'
              : 'h-12 w-[178px] rounded-full hover:h-[56px] hover:w-[286px]',
            isSubmitting && 'scale-[0.985]',
          )}
        >
          <div
            className="pointer-events-none absolute inset-[-2px] rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100"
            style={{ boxShadow: '0 0 0 1px rgba(12, 205, 205, 0.42)' }}
          />
          <MagicBorderBeam active={false} duration={8.5} delay={0.9} size={180} className="opacity-55" />
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.42),rgba(12,205,205,0.08)_46%,rgba(13,53,71,0.04))]" />
            <div
              className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-45"
              style={{
                background: `radial-gradient(circle 120px at ${hoverPosition.x}% ${hoverPosition.y}%, rgba(12,205,205,0.14), rgba(216,255,251,0.10) 42%, transparent 72%)`,
              }}
            />
          </div>
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-75">
            <div className="absolute inset-y-0 -left-2/3 w-2/3 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.48),transparent)] transition-transform duration-1000 ease-out group-hover:translate-x-[360%]" />
          </div>
          <div className="relative flex h-full flex-col">
            <button
              type="button"
              onClick={() => setState(isOpen ? 'closed' : 'open')}
              className={cn(
                'flex h-12 w-full items-center gap-2 px-3 text-left transition-all duration-500',
                !isOpen && 'justify-center hover:bg-slate-50',
              )}
            >
              <SignalOrb active={isSubmitting || isSuccess} />
              <span
                className={cn(
                  'min-w-0 truncate text-sm font-medium text-[#0d3547] transition-all duration-500',
                  isOpen ? 'flex-1 opacity-100' : 'max-w-[88px] group-hover:max-w-[180px]',
                )}
              >
                Ask Qlaus
              </span>
              {!isOpen ? (
                <span className="ml-auto hidden text-xs font-medium text-slate-400 opacity-0 transition-opacity duration-500 group-hover:inline group-hover:opacity-100">
                  type anything
                </span>
              ) : null}
              {isOpen ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
                      <Minus className="h-4 w-4" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Collapse agent</TooltipContent>
                </Tooltip>
              ) : null}
            </button>

            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col px-4 pb-4 opacity-0 transition-opacity duration-300',
                isOpen && 'opacity-100',
              )}
            >
              <div className="flex items-center justify-between gap-3 border-t border-slate-200/70 pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Chat with Qlaus</p>
                <Badge variant="secondary" className="rounded-full bg-white/70 text-slate-500">
                  Preview
                </Badge>
              </div>

              <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                <div className="max-w-[82%] rounded-2xl rounded-tl-md border border-slate-200 bg-white/80 px-4 py-3 text-sm leading-6 text-slate-600 shadow-sm">
                  I can help interpret the signals on this page, summarize account movement, or turn a messy next step into a short action plan.
                </div>
                <div className="ml-auto max-w-[82%] rounded-2xl rounded-tr-md bg-[#0d3547] px-4 py-3 text-sm leading-6 text-white shadow-sm">
                  Which accounts changed most this week?
                </div>
                <div className="max-w-[86%] rounded-2xl rounded-tl-md border border-cyan-100 bg-cyan-50/70 px-4 py-3 text-sm leading-6 text-[#0d3547] shadow-sm">
                  I would start with the accounts showing both fit movement and new external intent. The strongest pattern is usually where funding, hiring, and technology language shift together.
                </div>
              </div>

              <Textarea
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="Ask about this account, signal, cohort, or next move..."
                className="mt-4 min-h-[86px] resize-none rounded-2xl border-slate-200 bg-white/80 text-sm shadow-sm focus-visible:ring-arcova-teal"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.metaKey) {
                    event.preventDefault();
                    submitMock();
                  }
                }}
              />

              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5">⌘</kbd>
                  <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5">Enter</kbd>
                </div>
                <Button
                  type="button"
                  size="icon"
                  className="h-8 w-8 rounded-full bg-[#0d3547] text-white hover:bg-[#12465d]"
                  disabled={!value.trim() || isSubmitting}
                  onClick={submitMock}
                >
                  {isSubmitting ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : isSuccess ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <ArrowUp className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function BackgroundPreview({ mode }: { mode: BackgroundMode }) {
  return (
    <div
      className={cn(
        'relative min-h-[520px] overflow-hidden rounded-[28px] border shadow-sm',
        mode === 'clinical' && 'border-slate-200 bg-[#f6f8fb]',
        mode === 'signal' && 'border-cyan-100 bg-[radial-gradient(circle_at_20%_20%,rgba(12,205,205,0.18),transparent_28%),linear-gradient(135deg,#f8fbfd,#eef8f8)]',
        mode === 'dark' && 'border-white/10 bg-[#081f2a]',
      )}
    >
      <div
        className={cn(
          'absolute inset-0',
          mode === 'clinical' && 'bg-[linear-gradient(rgba(13,53,71,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(13,53,71,0.04)_1px,transparent_1px)] bg-[size:48px_48px]',
          mode === 'signal' && 'bg-[linear-gradient(90deg,rgba(12,205,205,0.08)_1px,transparent_1px)] bg-[size:56px_56px]',
          mode === 'dark' && 'bg-[radial-gradient(circle_at_70%_25%,rgba(12,205,205,0.16),transparent_26%)]',
        )}
      />
      <div className="relative flex min-h-[520px] flex-col p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {['Signal review', 'Fit movement', 'Next best action'].map((label, index) => (
            <div
              key={label}
              className={cn(
                'rounded-xl border p-4',
                mode === 'dark' ? 'border-white/10 bg-white/6 text-white' : 'border-white/70 bg-white/70 text-[#0d3547]',
              )}
            >
              <p className={cn('text-xs font-medium', mode === 'dark' ? 'text-white/55' : 'text-slate-500')}>
                0{index + 1}
              </p>
              <p className="mt-6 text-sm font-medium">{label}</p>
            </div>
          ))}
        </div>

        <div className="mt-auto">
          <AgentComposer state="open" setState={() => undefined} />
        </div>
      </div>
    </div>
  );
}

export default function AgentLabPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [panelState, setPanelState] = useState<PanelState>('open');
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('clinical');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  const stateLabel = useMemo(() => {
    if (panelState === 'closed') return 'Compact dock';
    if (panelState === 'submitting') return 'Thinking';
    if (panelState === 'success') return 'Success pulse';
    return 'Expanded composer';
  }, [panelState]);

  if (loading) {
    return <div className="min-h-screen bg-transparent" />;
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-transparent font-jakarta [&_h1]:font-manrope [&_h2]:font-manrope [&_h3]:font-manrope">
      <AppSidebar />

      <main className="arcova-scroll-surface min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
                <FlaskConical className="h-3.5 w-3.5" />
                Design lab
              </div>
              <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">
                Agent experience lab
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                A sandbox for shaping Qlaus: panel motion, dock behavior, page background, and control density.
              </p>
            </div>

            <Tabs value={backgroundMode} onValueChange={(value) => setBackgroundMode(value as BackgroundMode)}>
              <TabsList className="bg-white">
                <TabsTrigger value="clinical">Clinical</TabsTrigger>
                <TabsTrigger value="signal">Signal</TabsTrigger>
                <TabsTrigger value="dark">Dark</TabsTrigger>
              </TabsList>
            </Tabs>
          </header>

          <AnimateOnView animation="soft" randomKey="agent-lab-today">
            <TodayViewMockup />
          </AnimateOnView>

          <AnimateOnView animation="fade-up" randomKey="agent-lab-fonts">
            <FontSelectionStudy />
          </AnimateOnView>

          <AnimateOnView animation="pop" randomKey="agent-lab-magic">
            <MagicUiInstalledStrip />
          </AnimateOnView>

          <AnimateOnView animation="fade-up" randomKey="agent-lab-landing-backgrounds">
            <LandingBackgroundCandidates />
          </AnimateOnView>

          <AnimateOnView animation="fade-up" randomKey="agent-lab-react-bits">
            <ReactBitsMotionStudy />
          </AnimateOnView>

          <AnimateOnView animation="fade-up" randomKey="agent-lab-untitled">
            <UntitledUiInstalledStrip />
          </AnimateOnView>

          <AnimateOnView animation="soft" randomKey="agent-lab-canvas">
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
              <div
                className={cn(
                  'relative min-h-[560px] overflow-hidden rounded-[22px] border',
                  backgroundMode === 'clinical' && 'border-slate-200 bg-[#f6f8fb]',
                  backgroundMode === 'signal' && 'border-cyan-100 bg-[radial-gradient(circle_at_18%_18%,rgba(12,205,205,0.18),transparent_28%),linear-gradient(135deg,#f8fbfd,#edf8f8)]',
                  backgroundMode === 'dark' && 'border-white/10 bg-[#081f2a]',
                )}
              >
                <div className="absolute inset-0 bg-[linear-gradient(rgba(13,53,71,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(13,53,71,0.04)_1px,transparent_1px)] bg-[size:48px_48px]" />
                <div className="relative flex min-h-[560px] flex-col p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className={cn('text-sm font-medium', backgroundMode === 'dark' ? 'text-white/60' : 'text-slate-500')}>
                        Preview canvas
                      </p>
                      <h2 className={cn('mt-2 text-2xl font-semibold', backgroundMode === 'dark' ? 'text-white' : 'text-slate-950')}>
                        {stateLabel}
                      </h2>
                    </div>
                    <Badge className="rounded-full bg-cyan-500/12 text-arcova-teal hover:bg-cyan-500/12">
                      Qlaus v0
                    </Badge>
                  </div>

                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    {prompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        className={cn(
                          'rounded-xl border p-4 text-left text-sm leading-6 transition-colors',
                          backgroundMode === 'dark'
                            ? 'border-white/10 bg-white/6 text-white/80 hover:bg-white/10'
                            : 'border-white/80 bg-white/70 text-slate-600 hover:bg-white',
                        )}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>

                  <div className="mt-8 flex flex-1 items-end justify-center">
                    <AgentComposer state={panelState} setState={setPanelState} />
                  </div>
                </div>
              </div>
            </div>

            <aside className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <PanelBottomOpen className="h-4 w-4 text-arcova-teal" />
                  <h2 className="text-lg font-semibold text-slate-950">Panel state</h2>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {(['closed', 'open', 'submitting', 'success'] as PanelState[]).map((state) => (
                    <Button
                      key={state}
                      type="button"
                      variant={panelState === state ? 'default' : 'outline'}
                      className={cn('justify-start rounded-xl capitalize', panelState === state && 'bg-[#0d3547]')}
                      onClick={() => setPanelState(state)}
                    >
                      {state === 'closed' && <MessageSquareText className="mr-2 h-4 w-4" />}
                      {state === 'open' && <Bot className="mr-2 h-4 w-4" />}
                      {state === 'submitting' && <Sparkles className="mr-2 h-4 w-4" />}
                      {state === 'success' && <Check className="mr-2 h-4 w-4" />}
                      {state}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-arcova-teal" />
                  <h2 className="text-lg font-semibold text-slate-950">Design notes</h2>
                </div>
                <Separator className="my-4" />
                <div className="space-y-4 text-sm leading-6 text-slate-600">
                  <p>
                    This direction keeps the agent compact, shadcn-native, and calm. The orb becomes the memorable
                    identity moment without making the whole panel glow.
                  </p>
                  <p>
                    The background tabs are here so we can judge whether Qlaus should sit on a clean workspace, a
                    signal-aware surface, or a darker command environment.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-950">Current stance</p>
                    <p className="mt-1 text-sm text-slate-500">Clinical intelligence, restrained motion.</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="rounded-full">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </aside>
            </section>
          </AnimateOnView>

          <AnimateOnView animation="random" randomKey="agent-lab-components">
            <ComponentStudies />
          </AnimateOnView>

          <AnimateOnView animation="random" randomKey="agent-lab-surfaces">
            <AppSurfaceStudies />
          </AnimateOnView>

          <AnimateOnView animation="random" randomKey="agent-lab-waiting">
            <EnrichmentWaitingStudies />
          </AnimateOnView>

          <AnimateOnView animation="fade-up" randomKey="agent-lab-background">
            <BackgroundPreview mode={backgroundMode} />
          </AnimateOnView>
        </div>
      </main>
    </div>
  );
}
