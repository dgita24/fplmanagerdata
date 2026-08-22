export type FeaturedManager = {
  name: string;
  entryId: number;
  note?: string;
};

export const featuredManagers: FeaturedManager[] = [
  // Update this each season:
  { name: "Ben Crellin", entryId: 53517, note: "5yr rank - 33" }, 
  { name: "Fábio Borges", entryId: 3718868, note: "5yr rank - 577" },
  { name: "Tom Dollimore", entryId: 179777, note: "5yr rank  - 2" },
  { name: "Jovan Popović", entryId: 77750, note: "5yr rank - 94" }

];
