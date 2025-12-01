// engine/config.ts
// Canonical config for KPI Engine v10.7.5 (Option C-FULL)

export interface DomainConfig {
  allowedTaskTypes: string[];        // ['Project', ...]
  allowedTeamRoles: string[];        // ['Content', 'Content Lead', ...]
  genericCompanyTokens: string[];    // ['the company', 'the organization']
}

export interface DangerousPatternsConfig {
  extraDangerousSubstrings: string[];
  extraLowSignalPatterns: string[];
}

export interface PolicyFlags {
  allowEmojiInBenefit: boolean;
  allowHtmlLikeCompany: boolean;
  allowMultiCompanyPerRow: boolean;
}

export interface TenantConfig {
  name: string;
  domain: DomainConfig;
  dangerous: DangerousPatternsConfig;
  policy: PolicyFlags;
}

// Default (what you effectively do today)
export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  name: 'default',
  domain: {
    allowedTaskTypes: [
      'Project',
      'Change Request',
      'Consultation'
    ],
    allowedTeamRoles: [
      'Content',
      'Content Lead',
      'Design',
      'Design Lead',
      'Development',
      'Development Lead'
    ],
    genericCompanyTokens: [
      'the company', 'the organization'
    ]
  },
  dangerous: {
    extraDangerousSubstrings: [],
    extraLowSignalPatterns: []
  },
  policy: {
    allowEmojiInBenefit: false,
    allowHtmlLikeCompany: false,
    allowMultiCompanyPerRow: true
  }
  
};

