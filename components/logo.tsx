import Image from "next/image"
import Link from "next/link"

interface LogoProps {
  variant?: "full" | "icon"
  className?: string
}

export function Logo({ variant = "full", className = "" }: LogoProps) {
  if (variant === "icon") {
    return (
      <div className={`relative ${className}`}>
        <Image src="/images/arcova-icon.png" alt="Arcova" width={56} height={56} className="max-h-10 w-auto object-contain" />
      </div>
    )
  }

  return (
    <div className={`relative ${className}`}>
      <Image
        src="/images/arcova_logo-transparent.png"
        alt="Arcova"
        width={320}
        height={80}
        className="max-h-10 w-auto object-contain"
        priority
      />
    </div>
  )
}

export function LogoLink({ variant = "full", className = "" }: LogoProps) {
  return (
    <Link href="/" className={className}>
      <Logo variant={variant} />
    </Link>
  )
}
