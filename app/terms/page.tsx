import Link from "next/link"
import { Button } from "@/components/ui/button"

// Arcova color palette
const arcovaColors = {
  deepNavy: "#16253B",
  tealDark: "#00a4b4",
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container py-8 md:py-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
          
          <div className="prose prose-slate max-w-none">
            <p className="text-sm text-gray-500 mb-8">Last updated: May 2025</p>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">1. Introduction</h2>
              <p>
                Welcome to Arcova. By accessing or using our website and services ("Services"), you agree to these Terms of Service ("Terms"). If you do not agree, please do not use our Services.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">2. Who We Are</h2>
              <p>
                Arcova is a platform operated by Arcova Consulting Limited (referred to as "Arcova," "we," "us," or "our"), a company registered in New Zealand. We provide scientific biotech insights and risk assessment reports. All content is for informational purposes only and does not constitute financial, legal, or medical advice.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">3. No Investment Advice</h2>
              <p>
                Arcova does not provide investment, financial, legal, or medical advice. All decisions based on our reports or content are your sole responsibility.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">4. Services</h2>
              <p>
                Arcova provides biotech due diligence and risk monitoring and other science and consulting services.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">5. User Accounts</h2>
              <p>
                To access certain features of our platform, you may need to create an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">6. Intellectual Property</h2>
              <p>
                All content on this site—including text, graphics, logos, and reports—is the property of Arcova Consulting Limited or its licensors. You may not copy, reproduce, or distribute our materials without our written permission.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">7. Data Privacy</h2>
              <p>
                We take your privacy seriously. Our collection and use of personal information is governed by our Privacy Policy. By using our services, you consent to our data practices as described in our Privacy Policy.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">8. Confidentiality</h2>
              <p>
                Any confidential information shared through our platform will be treated in accordance with our confidentiality obligations and industry best practices for data security.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">9. Limitation of Liability</h2>
              <p>
                Arcova provides information and analysis for informational purposes only. We are not liable for any investment decisions made based on our services. Users should conduct their own due diligence and seek professional advice before making investment decisions.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">10. Changes to Terms</h2>
              <p>
                We may update these Terms from time to time. Changes will be posted here. Your continued use of the Services means you accept the updated Terms.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">11. Contact Us</h2>
              <p>
                If you have any questions about these Terms of Service, please contact us at{" "}
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