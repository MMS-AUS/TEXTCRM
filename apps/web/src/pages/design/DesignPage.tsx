import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Copy,
  Download,
  Inbox,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark } from '../../components/BrandMark.tsx';
import { ThemeMenu } from '../../components/ThemeMenu.tsx';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Skeleton,
  Textarea,
} from '../../ui/index.ts';
import { ControlsDemo, OverlaysDemo } from './ComponentDemos.tsx';
import { LeadsTableDemo } from './LeadsTableDemo.tsx';

const SECTIONS = [
  ['colour', 'Colour'],
  ['type', 'Type'],
  ['shape', 'Shape & elevation'],
  ['buttons', 'Buttons'],
  ['inputs', 'Inputs'],
  ['selection', 'Checkbox & badges'],
  ['cards', 'Cards'],
  ['controls', 'Select, switch & tabs'],
  ['menus', 'Menus'],
  ['overlays', 'Dialogs & toasts'],
  ['states', 'Empty & loading'],
  ['table', 'Data table'],
] as const;

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <div className="mb-4 border-b border-line pb-3">
        <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-fg-subtle">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const COLOUR_GROUPS: { title: string; tokens: string[] }[] = [
  {
    title: 'Surfaces',
    tokens: ['canvas', 'surface', 'surface-raised', 'surface-2', 'surface-3', 'sidebar'],
  },
  { title: 'Text & lines', tokens: ['fg', 'fg-muted', 'fg-subtle', 'line', 'line-strong'] },
  {
    title: 'Accent',
    tokens: ['accent', 'accent-hover', 'accent-subtle', 'accent-text', 'highlight', 'sun'],
  },
  {
    title: 'Status',
    tokens: [
      'success',
      'success-subtle',
      'warning',
      'warning-subtle',
      'danger',
      'danger-subtle',
      'info',
      'info-subtle',
    ],
  },
];

function Swatch({ token }: { token: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-12 rounded-md border border-line shadow-xs"
        style={{ background: `var(--${token})` }}
      />
      <code className="font-mono text-xs text-fg-muted">{token}</code>
    </div>
  );
}

const TYPE_SCALE = [
  ['text-3xl font-semibold tracking-tight', '3xl · 28px', 'Page title'],
  ['text-2xl font-semibold tracking-tight', '2xl · 22px', 'Section title'],
  ['text-xl font-semibold tracking-tight', 'xl · 18px', 'Dialog title'],
  ['text-lg font-medium', 'lg · 16px', 'Emphasised body'],
  ['text-base', 'base · 14px', 'Body text — the default for forms and detail pages'],
  ['text-sm', 'sm · 13px', 'Tables, controls, secondary text'],
  ['text-xs font-medium text-fg-muted', 'xs · 12px', 'Labels, metadata, badges'],
] as const;

export function DesignPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <BrandMark variant="full" />
            <span className="text-fg-subtle">/</span>
            <span className="text-fg-muted">Design system</span>
          </div>
          <ThemeMenu />
        </div>
        <nav
          aria-label="Sections"
          className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 text-sm sm:px-6"
        >
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="shrink-0 rounded-md px-2 py-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-14 px-4 py-10 sm:px-6">
        <div className="max-w-2xl">
          <Badge tone="accent">Graphite · Make My Solar</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Design system</h1>
          <p className="mt-2 text-base text-fg-muted">
            Two themes share every component: Graphite (quiet neutrals, indigo accent) and Make My
            Solar (white and navy, orange highlights, the real logos), each in light and dark. Use
            the palette menu in the top right to switch.
          </p>
        </div>

        <Section
          id="colour"
          title="Colour"
          description="Semantic tokens — screens use the role (surface, fg-muted, danger) and never a raw colour. The accent is a placeholder until the brand colours arrive (Task T-13)."
        >
          <div className="flex flex-col gap-6">
            {COLOUR_GROUPS.map((group) => (
              <div key={group.title}>
                <p className="mb-2 text-sm font-medium">{group.title}</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                  {group.tokens.map((token) => (
                    <Swatch key={token} token={token} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="type"
          title="Type"
          description="Inter (variable), self-hosted. Numbers in tables use tabular figures."
        >
          <Card>
            <CardContent className="flex flex-col divide-y divide-line py-0">
              {TYPE_SCALE.map(([classes, size, sample]) => (
                <div
                  key={size}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-6"
                >
                  <code className="w-28 shrink-0 font-mono text-xs text-fg-subtle">{size}</code>
                  <p className={classes}>{sample}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </Section>

        <Section
          id="shape"
          title="Shape & elevation"
          description="Small radii and soft, low shadows. Borders do most of the separating; shadows mark things that float."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                ['shadow-xs rounded-sm', 'xs · radius sm', 'Inputs, buttons'],
                ['shadow-sm rounded-md', 'sm · radius md', 'Cards'],
                ['shadow-md rounded-lg', 'md · radius lg', 'Menus, popovers'],
                ['shadow-lg rounded-xl', 'lg · radius xl', 'Dialogs, sheets'],
              ] as const
            ).map(([classes, name, use]) => (
              <div
                key={name}
                className={`flex h-28 flex-col justify-end border border-line bg-surface-raised p-3 ${classes}`}
              >
                <p className="text-sm font-medium">{name}</p>
                <p className="text-xs text-fg-muted">{use}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="buttons"
          title="Buttons"
          description="One primary action per view. Secondary for everything else, ghost inside dense UI, danger only for destructive confirmation."
        >
          <Card>
            <CardContent className="flex flex-col gap-6">
              {(['primary', 'secondary', 'ghost', 'danger'] as const).map((variant) => (
                <Specimen key={variant} label={variant}>
                  <Button variant={variant} size="sm">
                    Small
                  </Button>
                  <Button variant={variant}>Medium</Button>
                  <Button variant={variant} size="lg">
                    Large
                  </Button>
                  <Button variant={variant}>
                    <Plus />
                    With icon
                  </Button>
                  <Button variant={variant} loading>
                    Saving…
                  </Button>
                  <Button variant={variant} disabled>
                    Disabled
                  </Button>
                </Specimen>
              ))}
              <Specimen label="icon buttons (accessible name required)">
                <IconButton label="Edit" size="sm">
                  <Pencil />
                </IconButton>
                <IconButton label="Copy">
                  <Copy />
                </IconButton>
                <IconButton label="Settings" variant="secondary">
                  <Settings />
                </IconButton>
                <IconButton label="Download" variant="secondary" size="lg">
                  <Download />
                </IconButton>
                <IconButton label="Delete" variant="danger">
                  <Trash2 />
                </IconButton>
                <IconButton label="Loading" loading>
                  <Pencil />
                </IconButton>
              </Specimen>
              <Specimen label="as a link">
                <Button asChild variant="secondary">
                  <a href="#table">
                    Jump to the table
                    <ArrowRight />
                  </a>
                </Button>
              </Specimen>
            </CardContent>
          </Card>
        </Section>

        <Section
          id="inputs"
          title="Inputs"
          description="Labels sit above fields. Errors replace the hint, are announced to screen readers and say how to fix the problem."
        >
          <Card>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <Field label="Customer name" required>
                {(props) => <Input placeholder="e.g. Olivia Nguyen" {...props} />}
              </Field>
              <Field label="Email" hint="Quotes and invoices are sent here.">
                {(props) => <Input type="email" placeholder="name@example.com" {...props} />}
              </Field>
              <Field label="Search">
                {(props) => <Input leading={<Search />} placeholder="Search leads" {...props} />}
              </Field>
              <Field label="Mobile" error="Enter an Australian mobile, e.g. 0412 345 678.">
                {(props) => <Input type="tel" defaultValue="0412 34" {...props} />}
              </Field>
              <Field label="Lead ID" hint="Assigned automatically.">
                {(props) => <Input readOnly defaultValue="L-2026-0142" {...props} />}
              </Field>
              <Field label="Disabled">
                {(props) => <Input disabled defaultValue="Can't edit this" {...props} />}
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                {(props) => (
                  <Textarea placeholder="Roof type, shading, switchboard condition…" {...props} />
                )}
              </Field>
            </CardContent>
          </Card>
        </Section>

        <Section id="selection" title="Checkbox & badges">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Checkbox</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox /> Unchecked
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox defaultChecked /> Checked
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked="indeterminate" /> Some selected
                </label>
                <label className="flex items-center gap-2 text-fg-muted">
                  <Checkbox disabled /> Disabled
                </label>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Badges & status pills</CardTitle>
                <CardDescription>
                  A dot means a status; no dot means a label or count.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                  {(['neutral', 'accent', 'success', 'warning', 'danger', 'info'] as const).map(
                    (tone) => (
                      <Badge key={tone} tone={tone}>
                        {tone}
                      </Badge>
                    ),
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="info" dot>
                    New
                  </Badge>
                  <Badge tone="accent" dot>
                    Contacted
                  </Badge>
                  <Badge tone="warning" dot>
                    Quoted
                  </Badge>
                  <Badge tone="success" dot>
                    Won
                  </Badge>
                  <Badge tone="neutral" dot>
                    Lost
                  </Badge>
                  <Badge tone="danger" dot>
                    Overdue
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section
          id="cards"
          title="Cards"
          description="Sample content. A card groups one subject; avoid nesting cards inside cards."
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  [
                    'New leads · 7 days',
                    '24',
                    <Badge key="b" tone="success">
                      +12%
                    </Badge>,
                  ],
                  ['Installs this month', '9', <Badge key="b">3 booked</Badge>],
                  [
                    'Open tickets',
                    '4',
                    <Badge key="b" tone="warning" dot>
                      2 overdue
                    </Badge>,
                  ],
                ] as const
              ).map(([label, value, badge]) => (
                <Card key={label}>
                  <CardContent>
                    <p className="text-sm text-fg-muted">{label}</p>
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
                      {badge}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Company details</CardTitle>
                  <CardDescription>Shown on quotes and invoices.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <Field label="Trading name">
                    {(props) => <Input defaultValue="Make My Solar" {...props} />}
                  </Field>
                  <Field label="ABN">
                    {(props) => <Input placeholder="11 digits" {...props} />}
                  </Field>
                </CardContent>
                <CardFooter>
                  <Button variant="ghost">Cancel</Button>
                  <Button variant="primary">Save changes</Button>
                </CardFooter>
              </Card>
              <Card>
                <CardHeader
                  actions={
                    <Button size="sm" variant="ghost">
                      View all
                    </Button>
                  }
                >
                  <CardTitle>Upcoming installs</CardTitle>
                  <CardDescription>Next 7 days</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col divide-y divide-line py-0">
                  {(
                    [
                      ['Olivia Nguyen', 'Parramatta NSW · 10.56 kW + battery', 'Mon 9 Nov'],
                      ['Jack Patel', 'Toowoomba QLD · 6.6 kW', 'Wed 11 Nov'],
                      ['Grace Chen', 'Penrith NSW · 13.2 kW', 'Fri 13 Nov'],
                    ] as const
                  ).map(([name, detail, when]) => (
                    <div key={name} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{name}</p>
                        <p className="truncate text-sm text-fg-muted">{detail}</p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1.5 text-sm text-fg-muted">
                        <CalendarDays className="size-3.5" />
                        {when}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </Section>

        <Section
          id="controls"
          title="Select, switch & tabs"
          description="Select for one choice from a short list; switch for settings that apply immediately; tabs to split a record into sections."
        >
          <ControlsDemo />
        </Section>

        <Section
          id="menus"
          title="Menus"
          description="Keyboard: arrows to move, Enter to choose, Esc to close."
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                Actions
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Lead</DropdownMenuLabel>
              <DropdownMenuItem>
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Copy />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <Download />
                Export (no permission)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Section>

        <Section
          id="overlays"
          title="Dialogs & toasts"
          description="Dialogs for decisions, drawers for side panels and mobile navigation, tooltips for short hints, toasts for brief confirmations."
        >
          <OverlaysDemo />
        </Section>

        <Section id="states" title="Empty & loading">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <EmptyState
                icon={<Inbox />}
                title="No leads yet"
                description="Leads from Meta, Google and the website appear here automatically, or add one by hand."
                action={
                  <Button variant="primary">
                    <Plus />
                    Add lead
                  </Button>
                }
              />
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-4">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-center gap-3">
                    <Skeleton className="size-8 rounded-full" />
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-3.5 w-2/5" />
                      <Skeleton className="h-3 w-3/5" />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section
          id="table"
          title="Data table"
          description="Sample data behind a simulated server: click headers to sort, page through, select rows, hide columns from the Columns menu."
        >
          <LeadsTableDemo />
        </Section>
      </main>
    </div>
  );
}
