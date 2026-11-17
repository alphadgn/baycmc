import { z } from "zod";
import { COLLECTION_REGISTRY } from "@/lib/web3/constants";

export const clubCollectionSchema = z.object({
  label: z.string().regex(/^[A-Z0-9_]{2,40}$/),
  name: z.string().trim().min(1).max(120),
  contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.union([z.literal(1), z.literal(33139), z.literal(4663)]),
  tips: z.boolean(),
  access: z.enum(["full", "partner"]),
  active: z.boolean(),
});
export const clubConfigurationSchema = z.object({
  collections: z
    .array(clubCollectionSchema)
    .max(100)
    .superRefine((rows, ctx) => {
      const labels = new Set<string>();
      const contracts = new Set<string>();
      rows.forEach((row, i) => {
        const contract = `${row.chainId}:${row.contract.toLowerCase()}`;
        if (labels.has(row.label) || contracts.has(contract))
          ctx.addIssue({
            code: "custom",
            path: [i],
            message: "Duplicate collection label or contract",
          });
        labels.add(row.label);
        contracts.add(contract);
      });
    }),
  rules: z.string().trim().max(12000),
  socialLinks: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        url: z.url().refine((url) => new URL(url).protocol === "https:", "Use an HTTPS link"),
      }),
    )
    .max(20),
});
export type ClubConfiguration = z.infer<typeof clubConfigurationSchema>;
export type ClubCollection = z.infer<typeof clubCollectionSchema>;
export function parseClubConfiguration(value: unknown): ClubConfiguration {
  if (value && typeof value === "object" && Object.keys(value).length === 0)
    return { collections: COLLECTION_REGISTRY.map((c) => ({ ...c })), rules: "", socialLinks: [] };
  return clubConfigurationSchema.parse(value);
}
