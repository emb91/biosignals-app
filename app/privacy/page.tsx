import Link from "next/link"
import { Button } from "@/components/ui/button"

// Arcova color palette
const arcovaColors = {
  deepNavy: "#16253B",
  tealDark: "#00a4b4",
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container py-8 md:py-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
          
          <div className="prose prose-slate max-w-none">
            <p className="text-sm text-gray-500 mb-8">Last updated: May 2025</p>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">1. Introduction</h2>
              <p>
                Arcova Consulting Limited ("Arcova," "we," "us," or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you visit our website (arcova.bio) or use our services.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">2. Information We Collect</h2>
              <p>
                We collect information that you provide to us directly and information collected automatically when you use our website:
              </p>
              <ul className="list-disc pl-6 mt-4">
                <li>Contact Information: When you book a call, fill out a form, or contact us, you may provide your name, email address, company name, and other relevant details.</li>
                <li>Correspondence: If you contact us directly, we may receive additional information about you such as the contents of your message or attachments.</li>
                <li>Usage Data: We collect non-personal information about how you use our website, such as your browser type, pages visited, time spent on pages, and referring website.</li>
                <li>Cookies: We use basic cookies and similar tracking technologies to improve your website experience and understand site traffic. You can control cookie settings through your browser.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">3. How We Use Your Information</h2>
              <p>
                We may use your information to:
              </p>
              <ul className="list-disc pl-6 mt-4">
                <li>Respond to your enquiries or requests</li>
                <li>Schedule and manage calls or demos</li>
                <li>Improve and optimize our website and services</li>
                <li>Communicate with you about Arcova updates or offerings (you can opt out any time)</li>
                <li>Meet legal obligations</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">4. How We Share Your Information</h2>
              <p>
                We do not sell your personal information. We may share information with trusted service providers who help us operate our site and business, and only as needed for those purposes. We may also share information if required by law or to protect our rights, property, or safety.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">5. Data Storage and Security</h2>
              <p>
                We take reasonable steps to protect your information from unauthorized access or disclosure. However, no method of transmission over the Internet is 100% secure.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">6. Your Rights</h2>
              <p>
                You have the right to request access to or correction of your personal information, ask us to delete your data (subject to legal requirements), and withdraw consent for marketing at any time. To make a request, please contact us at{" "}
                <a 
                  href="mailto:emma@arcova.bio"
                  className="text-teal-600 hover:text-teal-700 transition-colors"
                >
                  emma@arcova.bio
                </a>.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">7. International Visitors</h2>
              <p>
                Arcova Consulting Limited is based in New Zealand. By using our website, you acknowledge that your information may be processed and stored in New Zealand or other countries.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">8. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. The most current version will always be posted on our website.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">9. Contact Us</h2>
              <p>
                If you have any questions about this Privacy Policy or our practices, please contact us at{" "}
                <a 
                  href="mailto:emma@arcova.bio"
                  className="text-teal-600 hover:text-teal-700 transition-colors"
                >
                  emma@arcova.bio
                </a>.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
} 