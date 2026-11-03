import {
  AU_STATES,
  COMPANY_SORTS,
  CONTACT_SORTS,
  LEAD_SORTS,
  ownerFilterSchema,
  PROJECT_SORTS,
  PROJECT_STAGES,
  PROJECT_STATUSES,
} from '@mms/shared';
import { z } from 'zod';

// URL search params of the list pages (?q=…&page=2&sort=name). Every key is optional and an
// invalid value is simply ignored, so a hand-edited or outdated link never breaks the page.

const PAGE_SIZES = [10, 25, 50, 100] as const;

const common = {
  q: z.string().max(100).optional().catch(undefined),
  type: z.string().max(100).optional().catch(undefined),
  archived: z.boolean().optional().catch(undefined),
  page: z.number().int().min(0).optional().catch(undefined),
  size: z
    .number()
    .refine((size) => PAGE_SIZES.some((allowed) => allowed === size))
    .optional()
    .catch(undefined),
  desc: z.boolean().optional().catch(undefined),
};

export const contactsSearchSchema = z.object({
  ...common,
  sort: z.enum(CONTACT_SORTS).optional().catch(undefined),
});
export type ContactsSearch = z.output<typeof contactsSearchSchema>;

export const companiesSearchSchema = z.object({
  ...common,
  sort: z.enum(COMPANY_SORTS).optional().catch(undefined),
});
export type CompaniesSearch = z.output<typeof companiesSearchSchema>;

const isoDate = z.iso.date().optional().catch(undefined);

export const leadsSearchSchema = z.object({
  q: common.q,
  status: z.array(z.string().max(100)).max(20).optional().catch(undefined),
  platform: common.type,
  owner: ownerFilterSchema.optional().catch(undefined),
  state: z.enum(AU_STATES).optional().catch(undefined),
  from: isoDate,
  to: isoDate,
  deleted: common.archived,
  page: common.page,
  size: common.size,
  sort: z.enum(LEAD_SORTS).optional().catch(undefined),
  desc: common.desc,
});
export type LeadsSearch = z.output<typeof leadsSearchSchema>;

export const projectsSearchSchema = z.object({
  /** Board (kanban by stage) or table. */
  view: z.enum(['board', 'table']).optional().catch(undefined),
  q: common.q,
  stage: z.array(z.enum(PROJECT_STAGES)).max(20).optional().catch(undefined),
  /** 'all' shows every status; absent means the default (Active). */
  status: z
    .enum([...PROJECT_STATUSES, 'all'])
    .optional()
    .catch(undefined),
  sales: ownerFilterSchema.optional().catch(undefined),
  state: z.enum(AU_STATES).optional().catch(undefined),
  dnsp: common.type,
  finance: common.type,
  stc: common.type,
  installer: z.uuid().optional().catch(undefined),
  from: isoDate,
  to: isoDate,
  page: common.page,
  size: common.size,
  sort: z.enum(PROJECT_SORTS).optional().catch(undefined),
  desc: common.desc,
});
export type ProjectsSearch = z.output<typeof projectsSearchSchema>;

export { PAGE_SIZES };
