import Image from "next/image"
import { Button } from "../components/primitives"

export function Nav() {
  return (
    <nav className="nav" id="lt4-nav">
      <div className="wrap nav-in">
        <a href="#top" aria-label="Arcova home">
          <Image className="nav-logo" src="/arcova-wordmark.png" alt="Arcova" width={104} height={26} priority style={{ height: 26, width: "auto" }} />
        </a>
        <div className="nav-right">
          <a className="nav-link" href="#how">How it works</a>
          <a className="nav-link" href="#pricing">Pricing</a>
          <Button variant="dark" href="/signup">Start for free</Button>
        </div>
      </div>
    </nav>
  )
}
