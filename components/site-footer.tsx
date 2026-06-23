import Link from "next/link"
import { Logo } from "@/components/logo"

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-100 bg-white">
      <div className="container grid grid-cols-1 sm:grid-cols-3 items-center py-6 px-4 md:px-6">
        {/* Left column: Icon + Copyright */}
        <div className="flex items-center justify-center sm:justify-start gap-2">
          <Logo variant="icon" size={22} />
          <span className="text-sm text-gray-500">© {new Date().getFullYear()} Arcova</span>
        </div>
        
        {/* Middle column: Links */}
        <div className="flex justify-center gap-6 my-4 sm:my-0">
          <Link
            href="/privacy"
            className="text-sm text-gray-600 hover:text-arcova-teal transition-colors duration-200"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="text-sm text-gray-600 hover:text-arcova-teal transition-colors duration-200"
          >
            Terms of Service
          </Link>
          <Link
            href="/contact-us"
            className="text-sm text-gray-600 hover:text-arcova-teal transition-colors duration-200"
          >
            Contact
          </Link>
        </div>

        {/* Right column: Social Icons */}
        <div className="flex items-center justify-center sm:justify-end gap-4">
          <Link
            href="https://www.linkedin.com/company/arcova-bio"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Emma Bardsley on LinkedIn"
            className="hover:opacity-80 transition-opacity duration-200"
          >
            <svg
              role="img"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" fill="#0A66C2"/>
            </svg>
          </Link>
        </div>
      </div>
    </footer>
  )
}
