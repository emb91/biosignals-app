"use client"

import { motion } from "framer-motion"
import { Pacifico } from "next/font/google"
import Image from "next/image"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ArrowRight, Users, Zap, LineChart, Handshake, Network, Sparkles } from "lucide-react"
import Link from "next/link"
import { ScrollToTop } from "@/components/scroll-to-top"
import { AnimatedSection } from "@/components/animated-section"
import { TypewriterQueryBuilder, CompanyTypewriter } from "@/components/TypewriterQueryBuilder"
import { SearchAnimation } from "@/components/SearchAnimation"
import { StaticMobileSearch } from "@/components/StaticMobileSearch"
import { SignalsTimeline } from "@/components/SignalsTimeline"
import { useIsMobile } from "@/hooks/use-mobile"
import { useState, useEffect } from "react"

const pacifico = Pacifico({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-pacifico",
})













export default function SignalsPage() {
  const [currentQuerySet, setCurrentQuerySet] = useState(0)
  const isMobile = useIsMobile()
  const [fundingData, setFundingData] = useState([
    { company: "NeuroSynth Bio", funding: "Series A $12M", stage: "A" },
    { company: "CellCure Therapeutics", funding: "Series B $45M", stage: "B" },
    { company: "BioVector Labs", funding: "SBIR Phase II $2.1M", stage: "SBIR" },
    { company: "GeneTech Solutions", funding: "Series C $78M", stage: "C" },
    { company: "MicroBio Dynamics", funding: "Pre-seed $850K", stage: "Pre" }
  ])

  // Update funding amounts periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setFundingData(prev => prev.map((item, index) => {
        if (index === 0 && item.stage === "A") {
          return { ...item, funding: "Series B $28M", stage: "B" }
        }
        if (index === 2 && item.stage === "SBIR") {
          return { ...item, funding: "Series A $8.5M", stage: "A" }
        }
        if (index === 4 && item.stage === "Pre") {
          return { ...item, funding: "Seed $2.3M", stage: "Seed" }
        }
        return item
      }))
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  const fadeUpVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
    },
  }

  return (
    <div className="flex min-h-dvh min-h-screen flex-col bg-transparent">
      <main className="flex-1">
        {/* Hero Section */}
        <div className="relative w-full overflow-hidden bg-gradient-to-br from-white via-arcova-mint/3 to-white py-16 md:py-20">

          <div className="relative z-10 container mx-auto px-4 md:px-6">
            <div className="flex flex-col items-center max-w-6xl mx-auto">
              {/* Main Content - Centered */}
              <div className="text-center mb-12">
                <div className="space-y-2 mb-8">
                  <motion.h1
                    initial="hidden"
                    animate="visible"
                    variants={fadeUpVariants}
                    transition={{ duration: 1, delay: 0.7, ease: "easeOut" }}
                    className="text-2xl md:text-4xl lg:text-5xl font-bold tracking-tight text-arcova-darkblue"
                    style={{ lineHeight: '1.2' }}
                  >
                    AI-powered revenue growth for 
                  </motion.h1>

                  <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={fadeUpVariants}
                    transition={{ duration: 1, delay: 0.9, ease: "easeOut" }}
                    className="text-2xl md:text-4xl lg:text-5xl font-bold tracking-tight text-arcova-teal"
                    style={{ lineHeight: '1.2' }}
                  >
                    <CompanyTypewriter />
                  </motion.div>
                </div>

                <motion.p
                  initial="hidden"
                  animate="visible"
                  variants={fadeUpVariants}
                  transition={{ duration: 1, delay: 1.3, ease: "easeOut" }}
                  className="text-lg text-arcova-darkblue/70 max-w-2xl mx-auto mb-8"
                  style={{ lineHeight: '1.4' }}
                >
                  Build an AI-powered sales engine that automatically identifies your ideal buyers, spots when they’re ready, and connects with the perfect message every time.


                </motion.p>

                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={fadeUpVariants}
                  transition={{ duration: 1, delay: 1.5, ease: "easeOut" }}
                  className="flex flex-col sm:flex-row gap-3 justify-center mt-8"
                >
                  <motion.div
                    whileHover={{ 
                      scale: 1.05,
                      boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"
                    }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    <Button size="lg" className="bg-arcova-teal hover:bg-arcova-teal/90 text-white px-8 py-3 text-base font-semibold rounded-xl transition-all duration-300 hover:shadow-lg group mt-4 mb-0">
                      <span className="flex items-center gap-2">
                        Talk with us 
                        <motion.span
                          animate={{ rotate: [0, 15, -15, 15, -15, 0] }}
                          transition={{ 
                            duration: 0.8, 
                            repeat: Infinity, 
                            repeatDelay: 1.5,
                            ease: "easeInOut" 
                          }}
                        >
                          👋
                        </motion.span>
                      </span>
                    </Button>
                  </motion.div>
                </motion.div>
              </div>




              {/* Signals Dashboard - Centered */}
              <motion.div
                initial="hidden"
                animate="visible"
                variants={fadeUpVariants}
                transition={{ duration: 1, delay: 1.7, ease: "easeOut" }}
                className="w-full max-w-4xl mx-auto px-8 -mt-8"
              >
                {/* Desktop/Tablet - Animated Version */}
                <div className="hidden md:block">
                  <div className="relative h-[460px]">
                    {/* Left side - Query Builder */}
                    <div className="absolute top-0 left-[-140px] w-[400px]">
                      <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 px-4 py-4">
                        {/* Query Builder Header */}
                        <div className="flex items-center space-x-3 mb-2">
                          <Sparkles className="w-5 h-5 text-arcova-teal" />
                          <span className="text-lg font-semibold text-arcova-darkblue mb-0">Find me companies that</span>
                        </div>

                        {/* Natural Language Query */}
                        <div className="flex-1">
                          <TypewriterQueryBuilder onQuerySetChange={setCurrentQuerySet} />
                        </div>
                      </div>
                    </div>

                    {/* Right side - Results */}
                    <div className="absolute top-[23px] left-[180px] right-[-160px]">
                      <SearchAnimation currentQuerySet={currentQuerySet} />
                    </div>
                  </div>
                </div>

                {/* Mobile - Static Version */}
                <div className="block md:hidden">
                  <StaticMobileSearch />
                </div>
              </motion.div>
            </div>
          </div>

          {/* <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-transparent to-white/40 pointer-events-none" /> */}
        </div>

        <AnimatedSection className="w-full pt-20 pb-12 bg-slate-50">
          <div className="container mx-auto px-4 md:px-6 max-w-7xl">
            <div className="text-center mb-6">
              <h2 className="text-4xl font-bold text-arcova-darkblue mb-6">
                Built for <span className="italic text-arcova-teal"> life science</span> companies
              </h2>
              <p className="text-lg text-arcova-darkblue/70 max-w-[1050px] mx-auto leading-relaxed">
                Our core team combines GTM experts, automation engineers, data scientists, and life science specialists from leading institutions. When projects require deeper expertise, we tap into our network of 200+ experts to source exactly what you need.
              </p>
            </div>
            
            {/* Institution Logos */}
            <div className="flex flex-wrap justify-center items-center gap-2 md:gap-4 lg:gap-6">
              {/* Oxford */}
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos dark/Oxford_dark.png"
                  alt="University of Oxford"
                  width={110}
                  height={112}
                  className="object-contain max-h-full"
                  style={{ filter: 'hue-rotate(220deg) saturate(1.2) brightness(0.8)' }}
                />
              </div>
              
              {/* Duke */}
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos dark/duke_dark.png"
                  alt="Duke University"
                  width={140}
                  height={112}
                  className="object-contain max-h-full"
                  style={{ filter: 'hue-rotate(220deg) saturate(1.2) brightness(0.8)' }}
                />
              </div>
              
              {/* MIT */}
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos dark/MIT_dark.png"
                  alt="MIT"
                  width={130}
                  height={112}
                  className="object-contain max-h-full"
                  style={{ filter: 'hue-rotate(220deg) saturate(1.2) brightness(0.8)' }}
                />
              </div>
              
              {/* Harvard */}
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos dark/harvard_dark.png"
                  alt="Harvard University"
                  width={160}
                  height={112}
                  className="object-contain max-h-full"
                  style={{ filter: 'hue-rotate(220deg) saturate(1.2) brightness(0.8)' }}
                />
              </div>
              
              {/* Yale */}
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos dark/yale_dark.png"
                  alt="Yale University"
                  width={140}
                  height={112}
                  className="object-contain max-h-full"
                  style={{ filter: 'hue-rotate(220deg) saturate(1.2) brightness(0.8)' }}
                />
              </div>
              
              {/* FDA */}
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos dark/fda_dark.png"
                  alt="FDA"
                  width={110}
                  height={112}
                  className="object-contain max-h-full"
                  style={{ filter: 'hue-rotate(220deg) saturate(1.2) brightness(0.8)' }}
                />
              </div>

              {/* NIH */}
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos dark/nih_dark.png"
                  alt="National Institutes of Health"
                  width={130}
                  height={112}
                  className="object-contain max-h-full"
                  style={{ filter: 'hue-rotate(220deg) saturate(1.2) brightness(0.8)' }}
                />
              </div>
            </div>
          </div>
        </AnimatedSection>
        
        {/* <div className="w-full py-16 bg-gradient-to-b from-white to-gray-50/30">
          <div className="container mx-auto px-8 md:px-16 lg:px-24">
                          <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-arcova-darkblue mb-8">
                81% of sales teams are <span className="italic text-arcova-teal">already</span> using AI
                </h2>
              <p className="text-lg text-gray-600 max-w-[700px] mx-auto">
              Forward-thinking companies are rewriting the rules of sales. Will you be left behind?
              </p> */}
              {/* <p className="text-lg text-gray-600 max-w-[700px] mx-auto">
              Do you want to be in the 20% left behind?
              </p> */}
            {/* </div> */}

            {/* <div className="relative">
              <div className="absolute inset-0 bg-arcova-mint/[0.15] rounded-2xl shadow-lg"></div>
              <div className="relative grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto py-8 px-6">
              <div className="text-center">
                  <div className="text-4xl font-bold text-arcova-darkblue mb-2">83%</div>
                  <div className="text-sm text-gray-600"> Grew revenue with AI vs 66% without it</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-arcova-darkblue mb-2">68%</div>
                  <div className="text-sm text-gray-600">Say AI helps them close more deals</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-arcova-darkblue mb-2">1.4x</div>
                  <div className="text-sm text-gray-600">More likely to increase headcount with AI</div>
                </div>
                                  <div className="text-center">
                   <div className="text-4xl font-bold text-arcova-darkblue mb-2">1 week</div>
                   <div className="text-sm text-gray-600"> Average reduction in sales cycle with AI</div>
                  </div>
                </div>
             
            </div>
            <div className="flex flex-col items-end mt-2 mb-4 px-6">
                <div className="text-xs space-y-1 text-right">
                  <div>
                    <a href="https://www.salesforce.com/blog/15-sales-statistics/" target="_blank" rel="noopener noreferrer" className="text-arcova-teal/70 hover:text-arcova-teal underline transition-colors">Salesforce's 50 Sales Statistics Report</a>
                  </div>
                  <div>
                    <a href="https://business.linkedin.com/content/dam/me/business/en-us/sales-solutions/resources/pdfs/linkedin-sales-navigator-roi-of-ai-report-2025-final.pdf" target="_blank" rel="noopener noreferrer" className="text-arcova-teal/70 hover:text-arcova-teal underline transition-colors">LinkedIn's Sales Leader Compass: The ROI of AI</a>
                  </div>
                </div>
              </div>
          </div>
        </div> */}

        {/* Impact Stats Section */}
        {/* <div className="w-full py-24 bg-white">
          <div className="container mx-auto px-8 md:px-16 lg:px-24">
            <h2 className="text-4xl font-bold text-arcova-darkblue mb-4 text-center">
            There's no <span className="italic text-arcova-teal">second place</span> in sales
            </h2>
            <p className="text-lg text-gray-600 max-w-[700px] mx-auto mb-16 text-center">
            81% of sales teams are already using AI. While competitors automate and accelerate, others spend time manually hunting for opportunites they'll never find fast enough.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-[1200px] mx-auto">
              <div className="bg-arcova-mint/[0.15] backdrop-blur-sm rounded-xl p-8 shadow-lg flex flex-col min-h-[280px]">
                <div>
                  <div className="text-2xl font-bold text-arcova-darkblue mb-4">Sales reps spend only 30% of their time selling</div>
                  <div className="text-base text-gray-600">
                  While your sales team spends 3.5 days eachNext.js. Each week AI has never been more powerful. Hello week on manual tasks, competitors with AI-enabled processes are closing deals.
                  </div>
                </div>
                <div className="mt-auto pt-4 text-right">
                  <a href="https://www.salesforce.com/content/dam/web/en_us/www/documents/reports/trends-in-generative-ai-for-sales-report.pdf" target="_blank" rel="noopener noreferrer" className="text-xs text-arcova-teal/70 hover:text-arcova-teal underline transition-colors">LinkedIn Trends in Gen AI Report</a>
                </div>
              </div>

              <div className="bg-arcova-teal rounded-xl p-8 text-white shadow-lg flex flex-col min-h-[280px]">
                <div>
                  <div className="text-2xl font-bold mb-4">Manual personalization is an opportunity cost</div>
                  <div className="text-base text-white/90">
                  While your reps spend hours researching and crafting messages, your competitors are sending hyperpersonalized emails built from AI-sourced insights at scale.
                  </div>
                </div>
                <div className="mt-auto pt-4 text-right">
                  <a href="https://www.salesforce.com/news/stories/sales-research-2023/" target="_blank" rel="noopener noreferrer" className="text-xs text-white/70 hover:text-white underline transition-colors">Salesforce's Sales Research</a>
                </div>
              </div>

              <div className="bg-arcova-darkblue rounded-xl p-8 text-white shadow-lg flex flex-col min-h-[280px]">
                <div>
                  <div className="text-2xl font-bold mb-4">The fastest vendor <br/>wins</div>
                  <div className="text-base text-white/90">
                  35-50% of deals go to the first vendor. If it's not you, it's your competitor. <br/>Speed wins.
                  </div>
                </div>
                <div className="mt-auto pt-4 text-right">
                  <a href="https://blog.hubspot.com/insiders/why-your-b2b-lead-response-time-is-killing-your-business?" target="_blank" rel="noopener noreferrer" className="text-xs text-white/70 hover:text-white underline transition-colors">Hubspot Insiders</a>
                </div>
              </div>
            </div>
          </div>
        </div> */}

        {/* Market Pain Points Quotes
        <div className="w-full py-12 bg-white">
          <div className="container mx-auto px-8 md:px-16 lg:px-24">
            <h2 className="text-4xl font-bold text-arcova-darkblue text-center mb-16 max-w-[1000px] mx-auto leading-tight">
            Manual prospecting is <span className="italic text-arcova-teal">losing</span> revenue
            </h2> */}

            {/* <div className="flex flex-col gap-6 max-w-[960px] mx-auto">
              {/* First row */}
              {/* <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                                <div className="md:col-span-5 bg-arcova-mint/[0.09] rounded-lg p-6 shadow-sm hover:shadow-md hover:bg-arcova-mint/[0.06] transition-all duration-300">
                  <p className="text-base text-arcova-teal font-medium leading-relaxed">
                    Too much time is spent on account research and not enough time selling.
                  </p>
                </div>
                <div className="md:col-span-3 bg-arcova-mint/[0.25] rounded-lg p-6 shadow-sm hover:shadow-md hover:bg-arcova-mint/[0.28] transition-all duration-300">
                  <p className="text-base text-arcova-teal font-medium leading-relaxed">
                    Data and information is scattered and stale.
                  </p>
                </div>
                <div className="md:col-span-4 bg-arcova-mint/[0.08] rounded-lg p-6 shadow-sm hover:shadow-md hover:bg-arcova-mint/[0.10] transition-all duration-300">
                  <p className="text-base text-arcova-teal font-medium leading-relaxed">
                    Generic outbound messages are sent to all prospects.
                  </p>
                </div>
              </div> */} 

              {/* Second row */}
              {/* <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                <div className="md:col-span-4 bg-arcova-mint/[0.15] rounded-lg p-6 shadow-sm hover:shadow-md hover:bg-arcova-mint/[0.18] transition-all duration-300">
                  <p className="text-base text-arcova-teal font-medium leading-relaxed">
                  Reps are finding opportunities too late or missing them entirely.</p>
                </div>
                <div className="md:col-span-3 bg-arcova-mint/[0.06] rounded-lg p-6 shadow-sm hover:shadow-md hover:bg-arcova-mint/[0.08] transition-all duration-300">
                  <p className="text-base text-arcova-teal font-medium leading-relaxed">
                    Reps are chasing the wrong accounts.
                  </p>
                </div>
                <div className="md:col-span-5 bg-arcova-mint/[0.20] rounded-lg p-6 shadow-sm hover:shadow-md hover:bg-arcova-mint/[0.23] transition-all duration-300">
                  <p className="text-base text-arcova-teal font-medium leading-relaxed">
                  You can't scale your best reps' methods to the rest of the team.
                  
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div> */}

        {/* painpoints */}
        {/* <AnimatedSection id="pain-points" className="w-full py-24 md:py-32 bg-white">
          <div className="container px-4 md:px-6 max-w-5xl">
            <div className="text-center mb-16">
              {/* <div className="inline-block px-3 py-1 bg-arcova-mint/30 text-arcova-teal rounded-full text-sm font-medium mb-6">
              Signal Strategy & Targeting
              </div> */}
              {/* <h2 className="text-4xl font-bold text-arcova-darkblue mb-6">
              What's holding your outreach   <span className="italic text-arcova-teal">back?</span>
              </h2>
              <p className="text-lg text-gray-600 max-w-[700px] mx-auto">
              Most sales teams rely on scattered, reactive workflows. It's slow, inconsistent, and leaves the best opportunities untouched.
              </p>
            </div>
            
            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12 items-start">
              <div className="relative h-[380px] md:h-[380px] shadow-xl rounded-2xl overflow-hidden order-1  w-full p-16">
                <Image
                  src="/images/painpoints.png"
                  alt="Pain points visualization"
                  fill
                  className="object-contain"
                  priority
                />
              </div>
              <div className="space-y-3">
                <div className="space-y-6 mb-6">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-arcova-teal p-1 mt-1 flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-arcova-darkblue mb-1">Fragmented inputs and old data</h4>
                      <p className="text-gray-600">Manual trial searches, publications, lead lists, trade shows. Disconnected and time-consuming.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-arcova-teal p-1 mt-1 flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-arcova-darkblue mb-1">Late to critical signals</h4>
                      <p className="text-gray-600">Funding, trials, and hires are spotted weeks later or missed entirely.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-arcova-teal p-1 mt-1 flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-arcova-darkblue mb-1">Manual, unsequenced outreach</h4>
                      <p className="text-gray-600">Generic, unsequenced messages without the right timing or context can lose you valuable opportunities.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-arcova-teal p-1 mt-1 flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-arcova-darkblue mb-1">No repeatable system </h4>
                      <p className="text-gray-600">Every rep works differently, so results are inconsistent and hard to scale.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div> */}
        {/* End of removed section */}

        {/* Signals Timeline Section */}
        <div className="w-full bg-white">
          <div className="container mx-auto px-4 md:px-6 pt-16 md:pt-28">
            <motion.div
              className="text-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <h2 className="text-4xl font-bold text-arcova-darkblue mb-6">
              We make revenue growth a <span className="italic text-arcova-teal">science</span>
              </h2>
              <p className="text-lg text-arcova-darkblue/70 max-w-3xl mx-auto leading-relaxed">
              We automate the processes that slow down growth, creating systems that allow your sales teams to sell, not prepare to sell.
              </p>
            </motion.div>
          </div>
          <div className="pt-8 md:pt-0">
            <SignalsTimeline />
          </div>
        </div>

       
    <div className="w-full py-16 bg-white">
          <div className="container mx-auto px-8 md:px-16 lg:px-24">
                          <div className="text-center mb-12">
                <h2 className="text-4xl font-bold text-arcova-darkblue mb-8">
                The AI advantage is <span className="italic text-arcova-teal">real</span>
                </h2>
              {/* <p className="text-lg text-gray-600 max-w-[700px] mx-auto">
              Forward-thinking companies are rewriting the rules of sales. Will you be left behind?
              </p> */}
              {/* <p className="text-lg text-gray-600 max-w-[700px] mx-auto">
              Do you want to be in the 20% left behind?
              </p> */}
            </div>

             <div className="relative">
              <div className="absolute inset-0 bg-arcova-mint/[0.15] rounded-2xl shadow-lg"></div>
              <div className="relative grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto py-8 px-6">
              <div className="text-center">
                  <div className="text-4xl font-bold text-arcova-darkblue mb-2">81%</div>
                  <div className="text-base text-arcova-darkblue/60">Sales teams already use AI</div>
                </div>
                <div className="text-center">
                <div className="text-4xl font-bold text-arcova-darkblue mb-2">1 week</div>
                <div className="text-base text-arcova-darkblue/60">Reduction in sales cycle with AI</div>
                </div>
                <div className="text-center">
                   <div className="text-4xl font-bold text-arcova-darkblue mb-2">81%</div>
                   <div className="text-base text-arcova-darkblue/60">Say AI reduces manual task time</div>
                  </div>
                </div>
              
            </div>
            <div className="flex flex-col items-end mt-2 mb-4 px-6">
                <div className="text-xs space-y-1 text-right">
                  <div>
                    <a href="https://www.salesforce.com/blog/15-sales-statistics/" target="_blank" rel="noopener noreferrer" className="text-arcova-teal/70 hover:text-arcova-teal underline transition-colors">Salesforce's 50 Sales Statistics Report</a>
                  </div>
                  <div>
                    <a href="https://business.linkedin.com/content/dam/me/business/en-us/sales-solutions/resources/pdfs/linkedin-sales-navigator-roi-of-ai-report-2025-final.pdf" target="_blank" rel="noopener noreferrer" className="text-arcova-teal/70 hover:text-arcova-teal underline transition-colors">LinkedIn's Sales Leader Compass: The ROI of AI</a>
                  </div>
                </div>
              </div>
          </div>
        </div>
      
  {/* Always on intelligece */}
  <AnimatedSection id="always-on-intelligence" className="w-full py-24 md:py-32 bg-white">
          <div className="container px-4 md:px-6 max-w-5xl">
            <div className="text-center mb-16">
              {/* <div className="inline-block px-3 py-1 bg-arcova-mint/30 text-arcova-teal rounded-full text-sm font-medium mb-6">
              Signal Strategy & Targeting
              </div> */}
              <h2 className="text-4xl font-bold text-arcova-darkblue mb-6 text-center">
              How we deliver <span className="italic text-arcova-teal">results</span>
              </h2>
              <p className="text-lg text-arcova-darkblue/70 max-w-[850px] mx-auto text-center">
              Don't waste budget on static lead lists. We continuously find and deliver qualified prospects, routing them straight into your CRM with the context you need to close deals.
              </p>
            </div>
            
            {/* Desktop layout with image */}
            <div className="hidden lg:grid gap-12 grid-cols-2 gap-16 items-center">
              <div className="relative h-[400px] shadow-xl rounded-2xl overflow-hidden">
                <Image
                  src="/images/workflow.png"
                  alt="Continuous pipeline visualization"
                  fill
                  className="object-cover"
                  priority
                />
              </div>
              <div className="space-y-3">
                <div className="space-y-6 mb-6">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-arcova-teal p-1 mt-1 flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-arcova-darkblue mb-1">Intelligent prospect scoring</h4>
                      <p className="text-arcova-darkblue/70">Our system scores and ranks prospects on buying intent and customer fit, so your team focuses only on high-probability opportunities.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-arcova-teal p-1 mt-1 flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-arcova-darkblue mb-1">Enrichment beyond conventional data providers</h4>
                      <p className="text-arcova-darkblue/70">If the data exists online, we'll find it at scale. We create custom AI agents that scrape unstructured data with remarkable precision.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-arcova-teal p-1 mt-1 flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-arcova-darkblue mb-1">Prospects flow into your workflow</h4>
                      <p className="text-arcova-darkblue/70">Qualified prospects automatically enter your CRM and outbound sequences with full context.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-arcova-teal p-1 mt-1 flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-arcova-darkblue mb-1">Scale your best performers</h4>
                      <p className="text-arcova-darkblue/70">
                      Analytics show what drives meetings and deals so you can replicate success across your team.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile/tablet layout without image */}
            <div className="lg:hidden">
              <div className="space-y-3">
                <div className="space-y-6 mb-6">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-arcova-teal p-1 mt-1 flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-arcova-darkblue mb-1">Intelligent prospect scoring</h4>
                      <p className="text-arcova-darkblue/70">Our system scores and ranks prospects on buying intent and customer fit, so your team focuses only on high-probability opportunities.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-arcova-teal p-1 mt-1 flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-arcova-darkblue mb-1">Enrichment beyond conventional data providers</h4>
                      <p className="text-arcova-darkblue/70">If the data exists online, we'll find it at scale. We create custom AI agents that scrape unstructured data with remarkable precision.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-arcova-teal p-1 mt-1 flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-arcova-darkblue mb-1">Prospects flow into your workflow</h4>
                      <p className="text-arcova-darkblue/70">Qualified prospects automatically enter your CRM and outbound sequences with full context.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-arcova-teal p-1 mt-1 flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-arcova-darkblue mb-1">Scale your best performers</h4>
                      <p className="text-arcova-darkblue/70">
                      Analytics show what drives meetings and deals so you can replicate success across your team.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </AnimatedSection>

 {/* Stats Section */}
 {/* <div className="w-full pt-0 pb-16 bg-gradient-to-b from-white to-gray-50/30">
          <div className="container mx-auto px-8 md:px-16 lg:px-24">
                          <div className="text-center mb-4"> */}
                {/* <h2 className="text-4xl font-bold text-arcova-darkblue mb-8">
                81% of sales teams are <span className="italic text-arcova-teal">already</span> using AI
                </h2>
              <p className="text-lg text-gray-600 max-w-[700px] mx-auto">
              Forward-thinking companies are rewriting the rules of sales. Will you be left behind?
              </p> */}
              {/* <p className="text-lg text-gray-600 max-w-[700px] mx-auto">
              Do you want to be in the 20% left behind?
              </p> */}
            {/* </div> */}

            {/* <div className="relative -mt-4">
              <div className="absolute inset-0 bg-arcova-darkblue rounded-2xl shadow-lg"></div>
              <div className="relative grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto py-8 px-6">
              <div className="text-center">
                  <div className="text-4xl font-bold text-white mb-2">86%</div>
                  <div className="text-sm text-white/90"> Sales pros who say AI improves upsell</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-white mb-2">83%</div>
                  <div className="text-sm text-white/90">Say AI helps them better understand buyer sentiment</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-white mb-2">50%</div>
                  <div className="text-sm text-white/90">Believe AI enables unparalleled scalability</div>
                </div>
                                  <div className="text-center">
                   <div className="text-4xl font-bold text-white mb-2">81%</div>
                   <div className="text-sm text-white/90">Sales pros who say AI helps reduce manual task time</div>
                  </div>
                </div>
             
            </div>
            <div className="flex flex-col items-end mt-2 mb-4 px-6">
                <div className="text-xs space-y-1 text-right">
                  <div>
                    <a href="https://offers.hubspot.com/ai-sales" target="_blank" rel="noopener noreferrer" className="text-arcova-teal/70 hover:text-arcova-teal underline transition-colors">HubSpot's AI Trends for Sales 2024 Report</a>
                  </div>
                  <div>
                    <a href="https://blog.hubspot.com/sales/sales-statistics" target="_blank" rel="noopener noreferrer" className="text-arcova-teal/70 hover:text-arcova-teal underline transition-colors">HubSpot's 2025 Sales Statistics</a>
                  </div>
                </div>
              </div>
          </div> */}
        {/* </div> */}
       

        {/* Built on Best-in-Class Tools Section */}
        <AnimatedSection className="w-full py-24 md:py-32 bg-white">
          <div className="container px-4 md:px-6 max-w-5xl">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-arcova-darkblue mb-6 text-center">
                Built on <span className="italic text-arcova-teal">best-in-class</span> tools
              </h2>
              <p className="text-lg text-gray-600/80 max-w-[700px] mx-auto text-center">
              Expertly implemented by people who push these tools to their limits. We build sophisticated automation, advanced workflows, and systems engineered for your specific challenges.
              </p>
            </div>

            {/* Tools Grid - Angled Single Row */}
            <div className="flex flex-wrap justify-center items-center gap-8">
              {/* Logo 1 - +15 degrees */}
              <div className="flex items-center justify-center" style={{ transform: 'rotate(5deg)' }}>
                <Image
                  src="/logos/5.png"
                  alt="Tool 1"
                  width={64}
                  height={64}
                  className="object-contain"
                />
              </div>

              {/* Logo 2 - -15 degrees */}
              <div className="flex items-center justify-center" style={{ transform: 'rotate(-5deg)' }}>
                <Image
                  src="/logos/2.png"
                  alt="Tool 2"
                  width={64}
                  height={64}
                  className="object-contain"
                />
              </div>

              {/* Logo 3 - +15 degrees */}
              <div className="flex items-center justify-center" style={{ transform: 'rotate(5deg)' }}>
                <Image
                  src="/logos/3.png"
                  alt="Tool 3"
                  width={64}
                  height={64}
                  className="object-contain"
                />
              </div>

              {/* Logo 4 - -15 degrees */}
              <div className="flex items-center justify-center" style={{ transform: 'rotate(-5deg)' }}>
                <Image
                  src="/logos/4.png"
                  alt="Tool 4"
                  width={64}
                  height={64}
                  className="object-contain"
                />
              </div>

              {/* Logo 5 - +15 degrees */}
              <div className="flex items-center justify-center" style={{ transform: 'rotate(5deg)' }}>
                <Image
                  src="/logos/6.png"
                  alt="Tool 5"
                  width={64}
                  height={64}
                  className="object-contain"
                />
              </div>

              {/* Logo 6 - -15 degrees */}
              <div className="flex items-center justify-center" style={{ transform: 'rotate(-5deg)' }}>
                <Image
                  src="/logos/8.png"
                  alt="Tool 6"
                  width={64}
                  height={64}
                  className="object-contain"
                />
              </div>

              {/* Logo 7 - +15 degrees */}
              <div className="flex items-center justify-center" style={{ transform: 'rotate(5deg)' }}>
                <Image
                  src="/logos/7.png"
                  alt="Tool 7"
                  width={64}
                  height={64}
                  className="object-contain"
                />
              </div>

              {/* Logo 8 - -15 degrees */}
              <div className="flex items-center justify-center" style={{ transform: 'rotate(-5deg)' }}>
                <Image
                  src="/logos/9.png"
                  alt="Tool 8"
                  width={64}
                  height={64}
                  className="object-contain"
                />
              </div>
            </div>
          </div>
        </AnimatedSection>

        {/* Our Approach Section */}
        <AnimatedSection id="our-approach" className="w-full py-24 md:py-32 bg-arcova-mint/10">
          <div className="container px-4 md:px-6 max-w-5xl">
            <div className="text-center mb-16">
              {/* <div className="inline-block px-3 py-1 bg-arcova-mint/30 text-arcova-teal rounded-full text-sm font-medium mb-6">
                Our approach
              </div> */}
              <h2 className="text-4xl font-bold text-arcova-darkblue mb-6 text-center">How we work with <span className="italic text-arcova-teal">you</span></h2>
              <p className="text-lg text-arcova-darkblue/70 max-w-[700px] mx-auto text-center">
                We partner with you to design, build, and integrate the systems that turn market signals into sales
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mt-8">
              {/* Selective partnerships */}
              {isMobile ? (
                <div
                  className="bg-white backdrop-blur-sm border border-gray-100 rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer"
                >
                  <div className="flex items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="h-5 w-5 text-[#f55f96]" />
                        <h3 className="font-bold text-lg text-arcova-darkblue">Quality partnerships</h3>
                      </div>
                      <p className="text-arcova-darkblue/70">We only work with a small number of clients at any one time so we can truly understand you and what you care about.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <motion.div
                  className="bg-white backdrop-blur-sm border border-gray-100 rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer md:hover:translate-y-[-5px] md:hover:shadow-xl"
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.8, delay: 0.1, ease: "easeOut" }}
                >
                  <div className="flex items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="h-5 w-5 text-[#f55f96]" />
                        <h3 className="font-bold text-lg text-arcova-darkblue">Quality partnerships</h3>
                      </div>
                      <p className="text-arcova-darkblue/70">We only work with a small number of clients at any one time so we can truly understand you and what you care about.</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Domain + engineering */}
              {isMobile ? (
                <div
                  className="bg-white backdrop-blur-sm border border-gray-100 rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer"
                >
                  <div className="flex items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="h-5 w-5 text-[#ffb996]" />
                        <h3 className="font-bold text-lg text-arcova-darkblue">Domain + engineering</h3>
                      </div>
                      <p className="text-arcova-darkblue/70">Our industry specialists work with automation engineers to bridge scientific expertise with technical execution.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <motion.div
                  className="bg-white backdrop-blur-sm border border-gray-100 rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer md:hover:translate-y-[-5px] md:hover:shadow-xl"
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
                >
                  <div className="flex items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="h-5 w-5 text-[#ffb996]" />
                        <h3 className="font-bold text-lg text-arcova-darkblue">Domain + engineering</h3>
                      </div>
                      <p className="text-arcova-darkblue/70">Our industry specialists work with automation engineers to bridge scientific expertise with technical execution.</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Collaborative delivery */}
              {isMobile ? (
                <div
                  className="bg-white backdrop-blur-sm border border-gray-100 rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer"
                >
                  <div className="flex items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <LineChart className="h-5 w-5 text-[#8d7dc7]" />
                        <h3 className="font-bold text-lg text-arcova-darkblue">Collaborative delivery</h3>
                      </div>
                      <p className="text-arcova-darkblue/70">We work alongside you to understand your customers, systems, and priorities, building tailored solutions that fit your unique requirements.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <motion.div
                  className="bg-white backdrop-blur-sm border border-gray-100 rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer md:hover:translate-y-[-5px] md:hover:shadow-xl"
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
                >
                  <div className="flex items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Handshake className="h-5 w-5 text-[#8d7dc7]" />
                        <h3 className="font-bold text-lg text-arcova-darkblue">Collaborative delivery</h3>
                      </div>
                      <p className="text-arcova-darkblue/70">We work with you to understand your customers, systems, and priorities, building tailored solutions that fit your needs.</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Seamless integration */}
              {isMobile ? (
                <div
                  className="bg-white backdrop-blur-sm border border-gray-100 rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer"
                >
                  <div className="flex items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Network className="h-5 w-5 text-[#00a4b4]" />
                        <h3 className="font-bold text-lg text-arcova-darkblue">Seamless integration</h3>
                      </div>
                      <p className="text-arcova-darkblue/70">Every workflow is built to fit into your CRM and existing sales stack so insights instantly become actions.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <motion.div
                  className="bg-white backdrop-blur-sm border border-gray-100 rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer md:hover:translate-y-[-5px] md:hover:shadow-xl"
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
                >
                  <div className="flex items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Network className="h-5 w-5 text-[#00a4b4]" />
                        <h3 className="font-bold text-lg text-arcova-darkblue">Seamless integration</h3>
                      </div>
                      <p className="text-arcova-darkblue/70">Every workflow is built to fit into your CRM and existing sales stack so insights instantly become actions.</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </AnimatedSection>


        

        {/* Team Section Header */}
        <AnimatedSection className="w-full pt-24 md:pt-32 pb-16 md:pb-20">
          <div className="container px-4 md:px-6 max-w-5xl">
            <div className="text-center mb-8">
              <h2 className="text-4xl font-bold text-arcova-darkblue mb-4">
                Who <span className="italic text-arcova-teal">we</span> are
              </h2>
              <p className="text-lg text-arcova-darkblue/70 max-w-[700px] mx-auto">
                Combining deep scientific expertise with commercial execution to help life science companies reach their full potential.
              </p>
            </div>
          </div>
        </AnimatedSection>

        {/* Team Bios Section */}
        <AnimatedSection className="w-full -mt-8 pb-24 md:pb-32">
          <div className="container px-4 md:px-6 max-w-[850px] mx-auto">
            {/* Photos and Names Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-16 mb-16">
              {/* Emma */}
              <div className="flex flex-col items-center">
                <div className="w-[280px] md:w-[320px] aspect-square relative overflow-hidden rounded-2xl shadow-xl mb-6">
                  <Image
                    src="/images/emma-bardsley-portrait.png"
                    alt="Emma Bardsley"
                    width={400}
                    height={400}
                    className="object-cover w-full h-full rounded-2xl"
                  />
                </div>
                <div className="w-[280px] md:w-[320px] text-left">
                  <h2 className="text-2xl font-bold text-arcova-darkblue mb-2">Emma Bardsley, PhD</h2>
                  <p className="text-lg text-arcova-darkblue/70 mb-4">Scientifc & Strategic Lead</p>
                  <div className="flex items-center gap-3">
                  <a 
                    href="https://www.linkedin.com/in/emmabardsley/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="hover:opacity-80 transition-opacity duration-200"
                    aria-label="LinkedIn Profile"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="#475569">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                  </a>
                  <a 
                    href="mailto:emma@arcova.bio"
                    className="hover:opacity-80 transition-opacity duration-200"
                    aria-label="Email"
                  >
                    <svg viewBox="0 0 24 24" className="h-[25px]" aria-hidden="true" fill="#475569">
                      <path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 4.99L4 6h16zm0 12H4V8l8 5 8-5v10z"/>
                    </svg>
                  </a>
                </div>
                </div>
              </div>

              {/* Peter */}
              <div className="flex flex-col items-center">
                <div className="w-[280px] md:w-[320px] aspect-square relative overflow-hidden rounded-2xl shadow-xl mb-6">
                  <Image
                    src="/images/peter-headshot.png"
                    alt="Peter Sloan"
                    width={400}
                    height={400}
                    className="object-cover w-full h-full rounded-2xl"
                  />
                </div>
                <div className="w-[280px] md:w-[320px] text-left">
                  <h2 className="text-2xl font-bold text-arcova-darkblue mb-2">Peter Sloan</h2>
                  <p className="text-lg text-arcova-darkblue/70 mb-4">Growth & Systems Lead</p>
                  <div className="flex items-center gap-3">
                  <a 
                    href="https://www.linkedin.com/in/sloanpeter/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="hover:opacity-80 transition-opacity duration-200"
                    aria-label="LinkedIn Profile"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="#475569">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                  </a>
                  <a 
                    href="mailto:peter.sloan@gotracksuit.com"
                    className="hover:opacity-80 transition-opacity duration-200"
                    aria-label="Email"
                  >
                    <svg viewBox="0 0 24 24" className="h-[25px]" aria-hidden="true" fill="#475569">
                      <path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 4.99L4 6h16zm0 12H4V8l8 5 8-5v10z"/>
                    </svg>
                  </a>
                </div>
                </div>
              </div>
            </div>

            {/* Joint Bio */}
            <div className="max-w-4xl mx-auto text-center px-4 md:px-0">
              <p className="text-lg text-arcova-darkblue/70 leading-relaxed max-w-[850px] mx-auto text-justify">
                <span className="font-bold">Emma and Peter combine deep scientific expertise with commercial capability to help life science companies compete and grow.</span> Emma holds a PhD from Oxford and moved into industry before founding <a href="https://www.arcova.bio" target="_blank" rel="noopener noreferrer" className="text-arcova-teal hover:text-arcova-teal/80">Arcova Bio</a> in 2023, bridging science and commercialization. Peter leads Go-to-Market Operations at Tracksuit, where he's helped scale the business from early stage to $21M ARR across seven markets.
              </p>
            </div>
          </div>
        </AnimatedSection>

   {/* Expert Institutions Logo Section - Commented Out */}
  {/*
  <AnimatedSection className="w-full pt-12 md:pt-16 pb-4 md:pb-6 bg-arcova-darkblue">
          <div className="container px-4 md:px-6 max-w-7xl">
            <div className="text-center mb-6">
              <h3 className="text-2xl md:text-3xl font-bold text-white mb-6">
                Deep expertise when you need it
              </h3>
              <p className="text-lg text-white/80 max-w-[1000px] mx-auto">
                Through our <a href="https://arcova.bio" target="_blank" rel="noopener noreferrer" className="text-arcova-mint hover:text-arcova-mint/80">Arcova Bio</a> consultancy, we have access to a network of 200+ specialists from top research institutions and industry when projects require deeper technical expertise or sector-specific insights.
              </p>
            </div>
            
            <div className="flex flex-wrap justify-center items-center gap-2 md:gap-4 lg:gap-6">
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos/Oxford.png"
                  alt="University of Oxford"
                  width={110}
                  height={112}
                  className="object-contain filter brightness-0 invert max-h-full"
                  style={{ filter: 'brightness(0) invert(1)' }}
                />
              </div>
              
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos/Duke.png"
                  alt="Duke University"
                  width={140}
                  height={112}
                  className="object-contain filter brightness-0 invert max-h-full"
                  style={{ filter: 'brightness(0) invert(1)' }}
                />
              </div>
              
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos/MIT.png"
                  alt="MIT"
                  width={130}
                  height={112}
                  className="object-contain filter brightness-0 invert max-h-full"
                  style={{ filter: 'brightness(0) invert(1)' }}
                />
              </div>
              
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos/Harvard.png"
                  alt="Harvard University"
                  width={160}
                  height={112}
                  className="object-contain filter brightness-0 invert max-h-full"
                  style={{ filter: 'brightness(0) invert(1)' }}
                />
              </div>
              
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos/Yale.png"
                  alt="Yale University"
                  width={140}
                  height={112}
                  className="object-contain filter brightness-0 invert max-h-full"
                  style={{ filter: 'brightness(0) invert(1)' }}
                />
              </div>
              
              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos/FDA.png"
                  alt="FDA"
                  width={110}
                  height={112}
                  className="object-contain filter brightness-0 invert max-h-full"
                  style={{ filter: 'brightness(0) invert(1)' }}
                />
              </div>

              <div className="flex items-center justify-center h-20 md:h-28 opacity-70 hover:opacity-100 transition-opacity duration-300">
                <Image
                  src="/expert logos/NIH.png"
                  alt="National Institutes of Health"
                  width={130}
                  height={112}
                  className="object-contain filter brightness-0 invert max-h-full"
                  style={{ filter: 'brightness(0) invert(1)' }}
                />
              </div>
            </div>
          </div>
        </AnimatedSection>
  */}
   

        {/* CTA Section */}
        <section className="py-32 md:py-40 bg-arcova-darkblue text-white relative overflow-hidden">
          {/* Background decorative elements */}
          <div className="absolute top-10 left-20 w-32 h-32 bg-white/[0.02] rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 right-10 w-40 h-40 bg-arcova-teal/[0.08] rounded-full blur-2xl"></div>
          
          <div className="container mx-auto px-4 md:px-6 max-w-5xl relative z-10">
            <div className="text-center space-y-12">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
              >
                <h2 className="text-4xl font-bold tracking-tight max-w-4xl mx-auto leading-tight">
                Ready to <span className="italic text-arcova-teal">automate</span> your outreach?
                </h2>
                <p className="text-xl max-w-[800px] text-white/90 max-w-3xl mx-auto mt-8 leading-relaxed">
                Send the right message. At the right moment. Every time.
                </p>
              </motion.div>

              <motion.div 
                className="flex flex-col sm:flex-row gap-6 justify-center"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <motion.div
                  whileHover={{ 
                    scale: 1.05,
                    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"
                  }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                  <Button
                    asChild
                    size="lg"
                    className="bg-arcova-teal hover:bg-arcova-teal/90 text-white px-8 py-3 text-base font-semibold rounded-xl transition-all duration-300 hover:shadow-lg group"
                  >
                    <a
                      href="https://calendly.com/emma-arcova/30min"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2"
                    >
                      <span className="flex items-center gap-2">
                        Talk with us 
                        <motion.span
                          animate={{ rotate: [0, 15, -15, 15, -15, 0] }}
                          transition={{ 
                            duration: 0.8, 
                            repeat: Infinity, 
                            repeatDelay: 1.5,
                            ease: "easeInOut" 
                          }}
                        >
                          👋
                        </motion.span>
                      </span>
                    </a>
                  </Button>
                </motion.div>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-2 border-white/30 text-white hover:bg-arcova-mint hover:text-arcova-darkblue hover:border-arcova-mint px-8 py-3 text-base font-semibold rounded-xl transition-all duration-300 hover:shadow-lg group backdrop-blur-sm bg-white/10"
                >
                  <Link href="/contact?utm_source=arcova.app" className="flex items-center gap-2">
                    Send a note
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </Button>
              </motion.div>
            </div>
          </div>
        </section>
      </main>

      <ScrollToTop />
    </div>
  )
}