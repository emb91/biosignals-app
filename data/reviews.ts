import { Users, Zap, BarChart, GraduationCap, FileText, LucideIcon, Star } from "lucide-react"

type ServiceType = {
  name: string
  icon: LucideIcon
  color: string
  lightColor: string
}

const serviceTypes = {
  strategy: {
    name: "Strategy",
    icon: Users,
    color: "#f55f96", // pink
    lightColor: "#fbcede"
  },
  content: {
    name: "Content",
    icon: Zap,
    color: "#ffb996", // orange
    lightColor: "#ffede4"
  },
  diligence: {
    name: "Diligence",
    icon: BarChart,
    color: "#8d7dc7", // purple
    lightColor: "#e7e0f5"
  },
  academic: {
    name: "Academic",
    icon: GraduationCap,
    color: "#00a4b4", // teal
    lightColor: "#daeff1"
  },
  report: {
    name: "Report",
    icon: FileText,
    color: "#216680", // blue
    lightColor: "#ccecfe"
  }
} as const

export interface Testimonial {
  quote: string | string[]
  author: {
    title?: string
    company?: string
  }
  serviceType: keyof typeof serviceTypes
}

export const testimonials: Testimonial[] = [
  {
    quote: "Able to translate scientific publications into blog post that are engaging and fun to read. People with no background in research will understand the subject matter.",
    author: {
      title: "CMO",
      company: "Behavioral Science Company"
    },
    serviceType: "content"
  },
  {
    quote: "Emma was amazing.",
    author: {
      title: "Marketing Lead",
      company: "Rehabilitation Clinic"
    },
    serviceType: "content"
  },
  {
    quote: "Profound knowledge and in-depth understanding of the neuroscience research field makes it easy to work and communicate with.",
    author: {
      title: "Marketing Lead",
      company: "Behavioral Science Company"
    },
    serviceType: "report"
  },
  {
    quote: "Not only do they explain the current science, but they also offer valuable industry insights, giving readers a well-rounded understanding of the business side of biotech.",
    author: {
      title: "Owner and Director",
      company: "Life Sciences Company"
    },
    serviceType: "strategy"
  },
  {
    quote: "They had the prowess to unpack the complexities of the biopharma and medical device industries.",
    author: {
      title: "Owner",
      company: "Biotech Training Firm"
    },
    serviceType: "strategy"
  },
  {
    quote: "Helped out both strategically and in a hands-on capacity.",
    author: {
      title: "Founder",
      company: "Health and Wellness Startup"
    },
    serviceType: "strategy"
  },
  {
    quote: "Proved to be very knowledgeable in the field. Organized, detailed and thorough.",
    author: {
      title: "Founder",
      company: "Digital Health Company"
    },
    serviceType: "strategy"
  },
  {
    quote: ["⭐️⭐️⭐️⭐️⭐️", "Five stars!"],
    author: {
      title: "Partner",
      company: "Family Investment Office"
    },
    serviceType: "diligence"
  },
  {
    quote: "Excellent summaries provided at short notice on a complicated scientific topic.",
    author: {
      title: "Researcher",
      company: "Academia"
    },
    serviceType: "academic"
  },
  {
    quote: "Everything I was looking for. They quickly developed a keen sense of what's important in our unique format, tackled the tasks expertly and gracefully and responded well to feedback.",
    author: {
      title: "Founder",
      company: "Scientific Software Company"
    },
    serviceType: "content"
  },
  {
    quote: "Building upon our previous collaboration, they once again demonstrated their exceptional skill set, dedication, and passion for delivering the highest quality of work.",
    author: {
      title: "Researcher",
      company: "Molecular Biology Group"
    },
    serviceType: "academic"
  },
  {
    quote: "Faced with a tight deadline, Emma was able to perform exceptionally well under pressure, being a fast worker but also diligent, providing high-quality work, incorporating excellent data analysis skills & contributing with valuable new ideas and insights for this project.",
    author: {
      title: "Researcher",
      company: "Bioinformatics Group"
    },
    serviceType: "report"
  },
  {
    quote: "The relentless effort, attention to detail, and deep commitment to the project were evident in every interaction and work she delivered.",
    author: {
      title: "Researcher",
      company: "Immunology Group"
    },
    serviceType: "report"
  }
]

export { serviceTypes } 