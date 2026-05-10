import Link from "next/link"
import Image from "next/image"

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-100 bg-white">
      <div className="container grid grid-cols-1 sm:grid-cols-3 items-center py-6 px-4 md:px-6">
        {/* Left column: Icon + Copyright */}
        <div className="flex items-center justify-center sm:justify-start gap-2">
          <Image src="/arcova-logo.png" alt="Arcova" width={24} height={24} />
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
            href="https://github.com/emb91/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Arcova on GitHub"
            className="hover:opacity-80 transition-opacity duration-200"
          >
            <svg
              role="img"
              viewBox="0 0 24 24"
              className="h-5 w-5 fill-[#181717]"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 .297a12 12 0 00-3.797 23.41c.6.111.817-.26.817-.577v-2.234c-3.34.726-4.042-1.416-4.042-1.416-.546-1.388-1.333-1.757-1.333-1.757-1.089-.745.083-.73.083-.73 1.205.084 1.84 1.236 1.84 1.236 1.07 1.834 2.809 1.303 3.495.998.108-.775.418-1.303.762-1.603-2.665-.3-5.466-1.332-5.466-5.931 0-1.311.469-2.381 1.235-3.221-.123-.303-.535-1.523.118-3.176 0 0 1.008-.322 3.3 1.23a11.52 11.52 0 013.003-.404c1.018.005 2.044.138 3.003.404 2.291-1.552 3.296-1.23 3.296-1.23.656 1.653.244 2.873.12 3.176.77.84 1.232 1.91 1.232 3.221 0 4.609-2.807 5.628-5.479 5.921.429.369.823 1.099.823 2.222v3.293c0 .319.216.694.826.576A12.003 12.003 0 0012 .297" />
            </svg>
          </Link>
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
