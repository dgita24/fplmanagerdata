export type FeaturedManager = {
  name: string;
  entryId: number;
  note?: string;
};

export const featuredManagers: FeaturedManager[] = [
  // Update this each season:
  { name: "Example Manager 1", entryId: 12345, note: "Content creator" },
  { name: "Example Manager 2", entryId: 67890, note: "Former player" },
];