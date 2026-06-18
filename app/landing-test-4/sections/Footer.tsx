import Image from "next/image"

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <Image className="foot-logo" src="/arcova-wordmark.png" alt="Arcova" width={88} height={22} style={{ height: 22, width: "auto" }} />
        <div className="links">
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="/signup">Start for free</a>
        </div>
        <div className="cr">© 2026 Arcova · GTM intelligence for life science</div>
      </div>
    </footer>
  )
}
