"use client"

import { motion, useScroll, useTransform, useSpring, useInView } from "framer-motion"
import { useRef, useState } from "react"
import Image from "next/image"

const signalEvents = [
      {
      title: "Find your ideal customers",
      description: "We work with you to define your ideal customer profile, then continuously filter thousands of companies that align with your target."
    },
  {
    title: "Automate your customer research",
    description: "AI scrapes recent developments, funding, and partnerships for qualified prospects, positioning you as a trusted advisor, not just another vendor."
  },
  {
    title: "Reach prospects at the perfect moment",
    description: "AI monitors your prospects for buying signals like funding rounds, new hires, or partnerships, then notifies your sales team when to engage."
  },
  {
    title: "Every message is personal and relevant",
    description: "We identify and enrich key contacts and KOLs at your target organizations, then automatically crafts personalized messages based on your research."
  },
  {
    title: "Built for sales teams",
    description: "We build and hand over the complete workflow so you own and control the entire system. You decide when to run it and how often."
  }
]

function TimelineEvent({
  event,
  index,
  isMobile = false,
  isTablet = false
}: {
  event: (typeof signalEvents)[0]
  index: number
  isMobile?: boolean
  isTablet?: boolean
}) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, amount: 0.5 })

  return (
    <motion.div
      ref={ref}
      className={`${isMobile ? 'mb-8' : '-mb-8'} flex justify-center w-full px-4 xl:px-0`}
      style={{ 
        paddingLeft: isMobile ? "5%" : (isTablet ? (index % 2 === 0 ? "10%" : "55%") : (index % 2 === 0 ? "5%" : "45%")), 
        paddingRight: isMobile ? "5%" : (isTablet ? (index % 2 === 0 ? "55%" : "10%") : (index % 2 === 0 ? "45%" : "5%")) 
      }}
      initial={{ opacity: 0, y: 50 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
      transition={{ duration: 0.8, delay: index * 0.1 }}
    >
      <motion.div
        className="w-[400px]"
      >
        <motion.div 
          className={`p-6 rounded-xl shadow-lg hover:shadow-xl min-h-[200px] flex flex-col transition-shadow duration-200 ${
            index % 2 === 0 ? 'bg-arcova-teal hover:bg-arcova-teal/90' : 
            'bg-arcova-darkblue hover:bg-arcova-darkblue/90'
          }`}
          whileHover={{ 
            scale: 1.02,
            y: -4,
            transition: { duration: 0.2 }
          }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.2 }}
        >
          <div className="mb-3">
            <h3 className={`text-xl font-bold ${index % 2 === 1 ? 'text-arcova-white' : 'text-white'}`}>{event.title}</h3>
          </div>
          <div>
            {event.description.split('\n').map((text, i) => (
              <p key={i} className={`text-base ${index % 2 === 1 ? 'text-arcova-white' : 'text-white'}`}>{text}</p>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

export function SignalsTimeline() {
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  })

  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  })

  return (
    <section ref={containerRef} className="py-24 pb-32 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        <div className="relative">
          {/* Vertical line */}
          <div
            className="absolute w-0.5 h-full bg-arcova-teal/20 z-0 hidden lg:block"
            style={{ left: 'calc(50% - 1px)' }}
          />

          {/* Moving signal icon */}
          <motion.div
            className="absolute z-10 hidden lg:block"
            style={{ 
              y: useTransform(scrollYProgress, [0, 1], [0, signalEvents.length * 160]),
              top: '0px',
              left: 'calc(50% - 24px)',
              transform: 'translateY(-50%)'
            }}
          >
            <Image
              src="/arcova-1000.png"
              alt="Arcova"
              width={48}
              height={48}
              className="w-12 h-12"
            />
          </motion.div>

          {/* Desktop timeline layout */}
          <div className="hidden xl:block">
            {signalEvents.map((event, index) => (
              <TimelineEvent
                key={event.title}
                event={event}
                index={index}
              />
            ))}
          </div>

          {/* Tablet timeline layout - alternating with proper spacing */}
          <div className="hidden lg:block xl:hidden">
            {signalEvents.map((event, index) => (
              <TimelineEvent
                key={event.title}
                event={event}
                index={index}
                isTablet={true}
              />
            ))}
          </div>

          {/* Mobile timeline layout - stacked vertically */}
          <div className="lg:hidden space-y-8">
            {signalEvents.map((event, index) => (
              <TimelineEvent
                key={event.title}
                event={event}
                index={index}
                isMobile={true}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
