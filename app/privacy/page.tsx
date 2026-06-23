export const metadata = {
  title: "Arcova | Privacy Policy",
  description: "How Arcova collects, uses, stores, and protects personal information.",
}

const contact = (
  <a className="text-teal-600 hover:text-teal-700" href="mailto:privacy@arcova.bio">
    privacy@arcova.bio
  </a>
)

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <article className="container mx-auto max-w-3xl px-6 py-12 text-slate-700">
        <h1 className="mb-3 text-4xl font-bold text-slate-950">Privacy Policy</h1>
        <p className="mb-10 text-sm text-slate-500">Last updated: June 20, 2026</p>

        <Section title="1. Who we are">
          <p>
            Arcova Consulting Limited (“Arcova,” “we,” “us,” or “our”) operates a revenue
            intelligence platform for life science companies and the businesses that sell to
            them. We are based in New Zealand. This policy applies to arcova.bio,
            app.arcova.bio, and the Arcova services.
          </p>
        </Section>

        <Section title="2. Information we process">
          <ul>
            <li>Account, workspace, billing, support, and communication information.</li>
            <li>
              Customer-provided CRM, contact, company, ICP, integration, and outreach data.
            </li>
            <li>
              Business contact and company information from public websites, professional
              profiles, regulatory sources, licensed data providers, and customer integrations.
            </li>
            <li>
              Product usage, device, log, security, cookie, and diagnostic information.
            </li>
            <li>
              Generated scores, classifications, summaries, recommendations, and outreach drafts.
            </li>
          </ul>
        </Section>

        <Section title="3. How we use information">
          <p>We use information to:</p>
          <ul>
            <li>Provide, secure, support, and improve Arcova.</li>
            <li>Import, deduplicate, enrich, score, monitor, and synchronize business records.</li>
            <li>Generate recommendations and customer-requested outreach content.</li>
            <li>Process subscriptions, credits, usage limits, and payments.</li>
            <li>Detect abuse, investigate incidents, and meet legal obligations.</li>
            <li>Send service communications and marketing where permitted.</li>
          </ul>
        </Section>

        <Section title="4. Customer data and roles">
          <p>
            For personal information a customer places in Arcova, the customer generally acts as
            controller and Arcova acts as processor or service provider. Customers are responsible
            for having a lawful basis to upload, use, and contact people in their records. For
            account administration, security, product analytics, and Arcova’s own business
            operations, Arcova may act as controller.
          </p>
        </Section>

        <Section title="5. AI and automated processing">
          <p>
            Arcova uses automated systems and AI models to classify records, assess fit and
            readiness, summarize business information, and draft content. These outputs may be
            incomplete or inaccurate and should be reviewed before use. Arcova does not make
            legally binding decisions about individuals.
          </p>
        </Section>

        <Section title="6. Service providers and subprocessors">
          <p>
            We use providers for cloud hosting, databases, authentication, payments, email,
            analytics, CRM connectivity, data enrichment, web data collection, AI processing,
            validation, outreach, monitoring, and backups. This currently includes providers such
            as Supabase, Vercel, Cloudflare, Stripe, Resend, Nango, HubSpot, Anthropic, OpenRouter,
            Apollo, Apify, ZeroBounce, and Lemlist where the relevant feature is used. We do not
            sell personal information for money.
          </p>
        </Section>

        <Section title="7. International transfers">
          <p>
            Information may be processed in New Zealand, the United States, Europe, and other
            countries where we or our providers operate. Where required, we use appropriate
            contractual or legal safeguards for international transfers.
          </p>
        </Section>

        <Section title="8. Retention and deletion">
          <p>
            We retain information for as long as needed to provide the service, meet contractual
            and legal obligations, resolve disputes, and protect the service. Retention periods
            vary by data type. Backups may persist for a limited period after live data is deleted.
            Customers may request workspace export or deletion by contacting us.
          </p>
        </Section>

        <Section title="9. Security">
          <p>
            We use access controls, encryption in transit, restricted service credentials,
            monitoring, backups, and other safeguards appropriate to the nature of the service.
            No system is completely secure. Please report suspected security issues to{" "}
            <a className="text-teal-600 hover:text-teal-700" href="mailto:security@arcova.bio">
              security@arcova.bio
            </a>.
          </p>
        </Section>

        <Section title="10. Cookies and analytics">
          <p>
            We may use necessary cookies for authentication and security and, where enabled,
            analytics technologies to understand website and product usage. You can control
            cookies through your browser and any consent controls we provide.
          </p>
        </Section>

        <Section title="11. Your rights">
          <p>
            Depending on your location, you may have rights to access, correct, delete, restrict,
            object to, or receive a copy of your personal information, and to withdraw consent.
            Contact {contact}. We may need to verify your identity and may direct requests about
            customer-controlled data to the relevant customer.
          </p>
        </Section>

        <Section title="12. Changes and contact">
          <p>
            We may update this policy as Arcova changes. Material changes will be posted here or
            communicated through the service. Questions and privacy requests can be sent to{" "}
            {contact}.
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
