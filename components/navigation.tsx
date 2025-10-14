import Link from "next/link"
import { useState } from "react"
import { LogoLink } from "@/components/logo"
import { Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { motion, AnimatePresence } from "framer-motion"
import { usePathname } from "next/navigation"

interface NavItem {
  name: string
  href: string
}

const navigation: NavItem[] = [
]

export const Navigation = () => {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  return (
    <header className="w-full flex justify-center bg-transparent sticky top-0 z-50">
      <nav className="w-full flex items-center justify-between bg-white/80 backdrop-blur-md shadow-sm border-b border-gray-200 px-6 py-4 relative">
        {/* Logo (always visible) */}
        <div className="flex items-center gap-4 flex-shrink-0 min-w-[120px] justify-start">
          <LogoLink />
        </div>
        {/* Desktop Nav (centered) */}
        <div className="flex-1 flex items-center justify-center">
          <ul className="hidden md:flex items-center gap-4">
            {navigation.map((item) => (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={`text-base font-medium transition-colors duration-200 pb-2 text-black border-b-2 ${pathname === item.href ? "border-arcova-teal" : "border-transparent"}`}
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        {/* CTA Button (Desktop, hidden on mobile) */}
        {/* <div className="hidden md:flex items-center">
          <Button ...> ... </Button>
        </div> */}
        {/* Enter App Button (Always visible, right-aligned, min-width to match logo) */}
        <div className="flex items-center justify-end min-w-[120px]">
          <Link href="/login">
            <Button className="bg-arcova-darkblue hover:bg-arcova-darkblue/90 text-white px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-300 hover:shadow-lg">
              Enter App
            </Button>
          </Link>
        </div>
      </nav>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex justify-end items-start"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Light translucent backdrop */}
            <div
              className="absolute inset-0 bg-white/60 backdrop-blur-md"
              onClick={() => setMobileOpen(false)}
            />

            {/* Right-aligned drawer */}
            <motion.div
              className="relative z-10 w-full max-w-xs sm:max-w-sm bg-white rounded-2xl shadow-xl p-6 m-4"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top row: Logo and Close button */}
              <div className="flex items-center justify-between mb-6">
                <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2">
                  <img
                    src="/images/arcova-logo.png"
                    alt="Arcova logo"
                    className="h-8 w-auto"
                  />
                </Link>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="p-2 rounded-full bg-arcova-teal/10 hover:bg-arcova-teal/20 text-arcova-teal transition"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Navigation menu */}
              <nav>
                <ul className="space-y-4">
                <li>
                    <a
                      href="https://calendly.com/emma-arcova/30min"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-base font-semibold px-4 py-2 rounded-lg text-arcova-darkblue bg-arcova-mint/40 hover:bg-arcova-teal/80 transition-all text-left"
                    >
                      Book a call 👋
                    </a>
                  </li>
                  <li>
                    <Link
                      href="/contact"
                      onClick={() => setMobileOpen(false)}
                      className="block text-base font-semibold px-4 py-2 rounded-lg text-arcova-darkblue bg-arcova-white hover:bg-arcova-teal/50 transition-all text-left"
                    >
                      Send a message
                    </Link>
                  </li>
               
                </ul>
              </nav>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
