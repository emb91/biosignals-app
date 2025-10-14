"use client"

import { motion } from "framer-motion"
import { useState, useEffect } from "react"

interface SearchAnimationProps {
  currentQuerySet: number
}

export function SearchAnimation({ currentQuerySet }: SearchAnimationProps) {
  const [isSearching, setIsSearching] = useState(false)
  const [searchComplete, setSearchComplete] = useState(false)

  const initialCompanies = [
    { name: "Loading...", url: "...", description: "...", funding: "...", ceo: "...", linkedin: "..." },
    { name: "Loading...", url: "...", description: "...", funding: "...", ceo: "...", linkedin: "..." },
    { name: "Loading...", url: "...", description: "...", funding: "...", ceo: "...", linkedin: "..." }
  ]

  const companySets = [
    [
          { name: "NeuroSynth Bio", url: "neurosynth-bio.com", description: "CAR-T cell therapy for neurological disorders", funding: "Series A $12M", ceo: "Dr. Sarah Chen", linkedin: "linkedin.com/company/neurosynth-bio" },
    { name: "CellCure Therapeutics", url: "cellcure-tx.com", description: "CAR-T cell therapy for solid tumors", funding: "Series A $45M", ceo: "Michael Rodriguez", linkedin: "linkedin.com/company/cellcure-therapeutics" },
    { name: "GeneTech Solutions", url: "genetech-sol.com", description: "Next-gen CAR-T manufacturing platforms", funding: "Series A $8.5M", ceo: "Dr. Emily Watson", linkedin: "linkedin.com/company/genetech-solutions" },
    { name: "MicroBio Dynamics", url: "microbio-dyn.com", description: "CAR-T cell therapy for hematologic cancers", funding: "Series A $25M", ceo: "James Thompson", linkedin: "linkedin.com/company/microbio-dynamics" }
    ],
    [
              { name: "Meridian Therapeutics", url: "meridian-therapeutics.com", description: "Started Phase I recruitment for oncology trials", funding: "Series B $35M", ceo: "Dr. Lisa Park", linkedin: "linkedin.com/company/meridian-therapeutics" },
       { name: "Beacon Biosciences", url: "beacon-bio.com", description: "Phase I immunotherapy recruitment launched", funding: "Series B $52M", ceo: "Robert Kim", linkedin: "linkedin.com/company/beacon-biosciences" },
       { name: "Catalyst Pharma", url: "catalyst-pharma.com", description: "Recruiting patients for Phase I CNS trials", funding: "Series B $28M", ceo: "Dr. Amanda Foster", linkedin: "linkedin.com/company/catalyst-pharma" },
       { name: "Vertex Biotech", url: "vertex-biotech.com", description: "Phase I rare disease trial recruitment active", funding: "Series B $41M", ceo: "David Martinez", linkedin: "linkedin.com/company/vertex-biotech" }
    ]
  ]
  
  const finalCompanies = companySets[currentQuerySet]
  const resultCounts = [50, 58] // Different counts for each query set

  // Animation effect - commented out for static view
  /*useEffect(() => {
    // Reset states when query set changes
    setIsSearching(false)
    setSearchComplete(false)

    // Start searching after typewriter completes (approximately 3 seconds)
    const searchTimer = setTimeout(() => {
      setIsSearching(true)
    }, 3000)

    // Complete search
    const completeTimer = setTimeout(() => {
      setSearchComplete(true)
      setIsSearching(false)
    }, 5500)

    return () => {
      clearTimeout(searchTimer)
      clearTimeout(completeTimer)
    }
  }, [currentQuerySet])*/

  // Set static completed state
  useEffect(() => {
    setSearchComplete(true)
    setIsSearching(false)
  }, [])

  const currentCompanies = searchComplete ? finalCompanies : initialCompanies
  const showTable = true // Always show table

  return (
    <>
      {/* Results Table */}
      {showTable && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-2 max-w-5xl mx-auto h-full">
          <div className="bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`w-6 h-6 rounded flex items-center justify-center transition-all duration-500 ${
                  searchComplete ? 'bg-arcova-teal' : 'bg-gray-400'
                }`}>
                  {isSearching ? (
                    <motion.div
                      className="w-3 h-3 border-2 border-white border-t-transparent rounded-full"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                  ) : searchComplete ? (
                    <span className="text-white text-xs">✓</span>
                  ) : (
                    <span className="text-white text-xs">⏳</span>
                  )}
                </div>
                <span className="font-semibold text-gray-900">
                  {isSearching ? 'Searching...' : searchComplete ? 'Search Results' : 'Preparing Search'}
                </span>
              </div>
              <span className="text-sm text-gray-500">
                {searchComplete ? `Found ${resultCounts[currentQuerySet]} companies` : 'Scanning database...'}
              </span>
            </div>
            
            <div className="overflow-x-auto relative">
              <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent via-white/30 to-white/60 pointer-events-none z-10" />
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">Company</th>
                                          <th className="px-2 py-3 text-left font-medium text-gray-600">Website</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Description</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 w-24">Funding</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600 w-24">LinkedIn</th>
                                          <th className="px-3 py-3 text-left font-medium text-gray-600">CEO</th>
                  </tr>
                </thead>
                <tbody>
                  {currentCompanies.map((company, index) => (
                    <motion.tr
                      key={`${company.name}-${index}`}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.8 + (index * 0.1) }}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center space-x-2">
                          {searchComplete && (
                            <motion.div
                              className="w-2 h-2 bg-green-400 rounded-full"
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ delay: 1.5 + (index * 0.1) }}
                            >
                              <motion.div
                                className="w-2 h-2 bg-green-400 rounded-full animate-pulse"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 1.8 + (index * 0.1) }}
                              />
                            </motion.div>
                          )}
                          <span className={`font-medium text-xs ${searchComplete ? 'text-gray-900' : 'text-gray-400'}`}>
                            {company.name}
                          </span>
                        </div>
                      </td>
                      <td className={`px-1 py-3 w-24 ${searchComplete ? 'text-blue-600' : 'text-gray-400'}`}>
                        <div className="text-xs truncate">
                          {company.url}
                        </div>
                      </td>
                      <td className={`px-3 py-3 w-48 ${searchComplete ? 'text-gray-600' : 'text-gray-400'}`}>
                        <div className="line-clamp-2 text-xs leading-tight">
                          {company.description}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {searchComplete ? (
                          <motion.div
                            className="text-center"
                            initial={{ opacity: 0.4 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 1.2 + (index * 0.1), duration: 0.5 }}
                          >
                            <div className="font-semibold text-xs text-gray-900">
                              {company.funding.split(' ')[0]} {company.funding.split(' ')[1]}
                            </div>
                            <div className="text-xs text-gray-600">
                              {company.funding.split(' ')[2]}
                            </div>
                          </motion.div>
                        ) : (
                          <div className="text-center">
                            <div className="font-semibold text-sm text-gray-400">
                              {company.funding.split(' ')[0]} {company.funding.split(' ')[1]}
                            </div>
                            <div className="text-xs text-gray-400">
                              {company.funding.split(' ')[2]}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className={`px-3 py-3 ${searchComplete ? 'text-blue-600' : 'text-gray-400'}`}>
                        <div className="text-xs leading-tight">
                          linkedin.com/{company.linkedin.split('/').slice(-2).join('/')}
                        </div>
                      </td>
                      <td className={`px-3 py-3 ${searchComplete ? 'text-gray-600' : 'text-gray-400'}`}>
                        <div className="text-xs">
                          {company.ceo}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}
    </>
  )
}
