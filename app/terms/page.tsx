export const metadata = {
  title: "Arcova | Terms of Service",
  description: "Terms governing use of the Arcova revenue intelligence platform.",
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <article className="container mx-auto max-w-3xl px-6 py-12 text-slate-700">
        <h1 className="mb-3 text-4xl font-bold text-slate-950">Terms of Service</h1>
        <p className="mb-10 text-sm text-slate-500">Last updated: June 20, 2026</p>

        <Section title="1. Agreement">
          <p>
            These Terms govern access to Arcova’s websites and revenue intelligence platform
            (the “Services”), operated by Arcova Consulting Limited, a New Zealand
            company. By using the Services, you agree to these Terms. If you use Arcova for an
            organization, you confirm that you can bind that organization.
          </p>
        </Section>

        <Section title="2. The Services">
          <p>
            Arcova helps life science commercial teams map markets, import and enrich business
            records, score fit and readiness, monitor business signals, generate outreach, and
            synchronize data with connected tools. Features may change as the product develops.
          </p>
        </Section>

        <Section title="3. Accounts and workspaces">
          <p>
            You must provide accurate account information and protect your credentials. Workspace
            owners and administrators control membership, integrations, and workspace data. You
            are responsible for activity conducted through your account and must notify us
            promptly of suspected unauthorized access.
          </p>
        </Section>

        <Section title="4. Customer data and lawful use">
          <p>
            You retain ownership of data you submit to Arcova. You grant us the rights needed to
            host, process, enrich, analyze, back up, and transmit that data to provide the
            Services. You are responsible for having the necessary rights and lawful basis to use
            the data, connect third-party systems, and contact prospects.
          </p>
          <p>You must not use Arcova to:</p>
          <ul>
            <li>Break privacy, marketing, employment, intellectual-property, or other laws.</li>
            <li>Send unlawful, deceptive, abusive, or unsolicited communications.</li>
            <li>Upload malware or attempt to bypass security, usage limits, or access controls.</li>
            <li>Resell, scrape, reverse engineer, or misuse the Services or supplied data.</li>
          </ul>
        </Section>

        <Section title="5. AI outputs and data quality">
          <p>
            Arcova uses automated systems and third-party sources. Scores, contact details,
            classifications, alerts, summaries, and generated outreach may be incomplete,
            delayed, or inaccurate. You must review outputs before relying on or sending them.
            Arcova does not guarantee that a prospect will respond, purchase, or be suitable.
          </p>
        </Section>

        <Section title="6. Plans, credits, and payment">
          <p>
            Paid plans are billed in advance for the selected term. Certain actions consume
            credits and certain features have usage or monitoring limits, as described in the
            product and credit documentation. Monthly subscription credits expire at rollover;
            annual subscription credits are granted upfront and expire at renewal; purchased
            credits expire as stated at purchase. Except where required by law, payments and
            unused credits are non-refundable.
          </p>
          <p>
            We may suspend paid actions or monitoring after a failed-payment grace period. Plan
            changes and cancellations take effect as presented during purchase or in billing
            settings.
          </p>
        </Section>

        <Section title="7. Integrations and third-party services">
          <p>
            You authorize Arcova to access connected services on your behalf. Third-party services
            have their own terms and availability. We are not responsible for changes, outages,
            or actions by those providers. You may disconnect integrations through Arcova or the
            provider.
          </p>
        </Section>

        <Section title="8. Confidentiality and security">
          <p>
            Each party will protect the other party’s confidential information and use it only to
            perform under these Terms. We use reasonable safeguards, but no online service is
            completely secure. You remain responsible for configuring your workspace and
            integrations appropriately.
          </p>
        </Section>

        <Section title="9. Intellectual property and feedback">
          <p>
            Arcova and its licensors own the Services, software, designs, models, and documentation.
            These Terms give you a limited, non-exclusive, non-transferable right to use the
            Services during your subscription. You may use outputs generated for your workspace,
            subject to law and third-party rights. We may use feedback without restriction.
          </p>
        </Section>

        <Section title="10. Suspension and termination">
          <p>
            We may suspend or terminate access for material breach, non-payment, security risk,
            unlawful use, or harm to the Services or others. You may stop using Arcova at any time.
            On termination, access ends and we may delete workspace data following our retention
            practices, subject to legal obligations and any agreed export period.
          </p>
        </Section>

        <Section title="11. Disclaimers">
          <p>
            The Services are provided “as is” and “as available.” To the maximum extent permitted
            by law, Arcova disclaims implied warranties, including merchantability, fitness for a
            particular purpose, non-infringement, and uninterrupted or error-free operation.
          </p>
        </Section>

        <Section title="12. Liability">
          <p>
            To the maximum extent permitted by law, neither party is liable for indirect,
            incidental, special, consequential, or punitive damages, or lost profits, revenue,
            goodwill, or data. Arcova’s total liability arising from the Services will not exceed
            the fees paid by the customer to Arcova in the twelve months before the event giving
            rise to the claim. This limitation does not apply where it cannot lawfully apply.
          </p>
        </Section>

        <Section title="13. General">
          <p>
            These Terms and any applicable order form form the entire agreement regarding the
            Services. New Zealand law governs these Terms, and the courts of New Zealand have
            exclusive jurisdiction, unless mandatory law provides otherwise. We may update these
            Terms and will provide reasonable notice of material changes.
          </p>
        </Section>

        <Section title="14. Contact">
          <p>
            Questions about these Terms can be sent to{" "}
            <a className="text-teal-600 hover:text-teal-700" href="mailto:legal@arcova.bio">
              legal@arcova.bio
            </a>.
          </p>
        </Section>
      </article>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 space-y-3 [&_li]:mb-2 [&_ul]:list-disc [&_ul]:pl-6">
      <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
      {children}
    </section>
  )
}
