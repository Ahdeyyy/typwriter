export interface LicensePackage {
  name: string;
  version: string;
  ecosystem: string;
  license: string;
  notices: { title: string; text: string }[];
}

export interface LicenseCatalog {
  packages: LicensePackage[];
  texts: Record<string, string>;
}
