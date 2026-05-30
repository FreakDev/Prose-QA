import { z } from "zod";

export const SkillFrontmatterSchema = z.object({
  name: z
    .string()
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(1024),
  "allowed-tools": z.string().optional(),
  compatibility: z.string().optional(),
  license: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface SkillCatalogEntry {
  name: string;
  description: string;
  dir: string;
  frontmatter: SkillFrontmatter;
}

export interface Skill extends SkillCatalogEntry {
  body: string;
}
