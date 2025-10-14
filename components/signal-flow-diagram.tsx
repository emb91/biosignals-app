"use client"

import Image from "next/image"

export function SignalFlowDiagram() {
  return (
    <div className="w-full h-full">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-[1200px] mx-auto">
        <div className="bg-arcova-darkblue rounded-xl p-8 text-white shadow-lg flex flex-col min-h-[280px]">
          <div>
            <div className="text-2xl font-bold mb-4">Signal Detection</div>
            <div className="text-base text-white/90">
              Continuous monitoring of market signals across multiple data sources to identify potential opportunities.
            </div>
          </div>
        </div>

        <div className="bg-arcova-teal rounded-xl p-8 text-white shadow-lg flex flex-col min-h-[280px]">
          <div>
            <div className="text-2xl font-bold mb-4">AI Analysis</div>
            <div className="text-base text-white/90">
              Advanced AI processing to evaluate signal relevance and match with your ideal customer profile.
            </div>
          </div>
        </div>

        <div className="bg-arcova-darkblue rounded-xl p-8 text-white shadow-lg flex flex-col min-h-[280px]">
          <div>
            <div className="text-2xl font-bold mb-4">Automated Action</div>
            <div className="text-base text-white/90">
              Instant routing to your CRM with enriched context for immediate, personalized engagement.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
