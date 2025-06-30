export interface ResumeExtractedKeywords {
  hardSkills: string[];
  softSkills: string[];
  qualifications: string[];
  keywords: string[];
}
export interface ResumeAnalysis {
  skillMatchScore: number;
  missingKeywords: string[];
  resumeEmbedding: number[];
}

export interface ContactInfo {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin?: string;
  portfolio?: string;
  github?: string;
}

export interface Skills {
  languages: Array<string>;
  frameworks: Array<string>;
  tools: Array<string>;
  databases: Array<string>;
  concepts: Array<string>;
}

export interface Experience {
  company: string;
  position: string;
  duration: string;
  location: string;
  responsibilities: string[];
  achievements: string[];
  startDate: string;
  endDate: string;
  technologies?: string; // Optional technologies used in the role
}

export interface Education {
  institution: string;
  degree: string;
  major: string;
  startDate: string;
  endDate: string;
}

export interface Certification {
  name: string;
  issuer: string;
  date: string;
  expiryDate?: string;
  credentialId?: string;
}

export interface AdditionalSection {
  title: string;
  items: string[];
}

export interface TailoredContent {
  title?: string; // Candidate's professional title
  contactInfo: ContactInfo;
  summary: string;
  skills: Skills;
  experience: Experience[];
  education: Education[];
  certifications: Certification[];
  additionalSections: AdditionalSection[];
}

export interface AnalysisResult extends TailoredContent {
  metadata: {
    skillMatchScore: number;
    missingKeywords: string[];
  };
}
