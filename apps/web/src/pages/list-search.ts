import { COMPANY_SORTS, CONTACT_SORTS } from '@mms/shared';
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

export { PAGE_SIZES };
