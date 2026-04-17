export const BUSINESS_AREA_OPTIONS = [
  'Executive Leadership',
  'Business Development & Partnerships',
  'Clinical Operations',
  'Research & Development',
  'Regulatory Affairs',
  'Manufacturing & CMC',
  'Medical Affairs',
  'Commercial & Sales Operations',
  'Procurement',
  'Strategy & Corporate Development',
  'Lab Operations',
  'Technology & Systems',
  'AI & Machine Learning',
  'Marketing',
] as const;

export const SENIORITY_LEVEL_OPTIONS = [
  'C-Level',
  'VP / SVP',
  'Director',
  'Head of / Senior Manager',
  'Manager',
  'Individual Contributor',
] as const;

export type BusinessArea = (typeof BUSINESS_AREA_OPTIONS)[number];
export type SeniorityLevel = (typeof SENIORITY_LEVEL_OPTIONS)[number];
