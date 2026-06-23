import { Logo } from "@/components/logo"
import { Button } from "../components/primitives"

export function Nav() {
  return (
    <nav className="nav" id="lt6-nav">
      <div className="wrap nav-in">
        <a href="#top" aria-label="Arcova home" className="nav-logo">
          <Logo size={28} badge="none" />
        </a>
        <div className="nav-mid">
          <a className="nav-link" href="#how">How it works</a>
          <a className="nav-link" href="#why">Why Arcova</a>
          <a className="nav-link" href="#pricing">Pricing</a>
        </div>
        <div className="nav-right">
          <a className="nav-signin" href="/login">Sign in</a>
          <Button variant="dark" href="/signup">Start for free</Button>
        </div>
      </div>
    </nav>
  )
}
