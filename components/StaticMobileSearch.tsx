"use client"

export function StaticMobileSearch() {
  // Use the Series B query set (index 1) as the default for mobile
  const staticQuery = [
    { text: "have started Phase I recruitment last month", color: "green" },
    { text: "raised Series B in the last 6 months", color: "blue" },
    { text: "over 50 employees", color: "purple" },
    { text: "located in United States", color: "orange" }
  ]

  const staticCompanies = [
    { name: "Meridian Therapeutics", url: "meridian-therapeutics.com", description: "Started Phase I recruitment for oncology trials", funding: "Series B $35M", employees: 67, linkedin: "linkedin.com/company/meridian-therapeutics" },
    { name: "Beacon Biosciences", url: "beacon-bio.com", description: "Phase I immunotherapy recruitment launched", funding: "Series B $52M", employees: 89, linkedin: "linkedin.com/company/beacon-biosciences" },
    { name: "Catalyst Pharma", url: "catalyst-pharma.com", description: "Recruiting patients for Phase I CNS trials", funding: "Series B $28M", employees: 73, linkedin: "linkedin.com/company/catalyst-pharma" }
  ]

  const getColorClasses = (color: string) => {
    const colorMap = {
      blue: { text: "text-blue-800", bg: "bg-blue-50", border: "border-blue-400" },
      green: { text: "text-green-800", bg: "bg-green-50", border: "border-green-400" },
      purple: { text: "text-purple-800", bg: "bg-purple-50", border: "border-purple-400" },
      orange: { text: "text-orange-800", bg: "bg-orange-50", border: "border-orange-400" }
    }
    return colorMap[color as keyof typeof colorMap] || colorMap.blue
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Query Builder Header and Static Query */}
      <div>
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-8 h-8 bg-arcova-teal rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">✨</span>
          </div>
          <span className="text-lg font-semibold text-gray-900">Find biotechs that</span>
        </div>

        {/* Static Query */}
        <div className="space-y-1">
          {staticQuery.map((step, index) => {
            const colors = getColorClasses(step.color)
            return (
              <div key={index} className="flex items-center gap-2 text-sm relative min-h-[1.9rem]">
                <div className="relative">
                  <div className={`${colors.bg} ${colors.text} font-medium border-2 ${colors.border} w-[231px] min-h-[1.5rem] flex items-center pb-1 px-2 py-0.5 rounded-md`}>
                    <span>{step.text}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Static Results */}
      <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50">
        <div className="bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 rounded flex items-center justify-center bg-arcova-teal">
                <span className="text-white text-xs">✓</span>
              </div>
              <span className="font-semibold text-gray-900">Search Results</span>
            </div>
            <span className="text-sm text-gray-500">Found 8 companies</span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Company</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Description</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Funding</th>
                </tr>
              </thead>
              <tbody>
                {staticCompanies.map((company, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    <td className="px-3 py-2">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-green-400 rounded-full" />
                        <span className="font-medium text-gray-900">{company.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">
                      {company.description}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-center">
                        <div className="font-semibold text-sm text-gray-900">
                          {company.funding.split(' ')[0]} {company.funding.split(' ')[1]}
                        </div>
                        <div className="text-xs text-gray-600">
                          {company.funding.split(' ')[2]}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
