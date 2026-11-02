import { Bell, FileText, History, Info, Trash2, Wrench } from 'lucide-react';
import { useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  Field,
  IconButton,
  Input,
  Label,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  Tooltip,
} from '../../ui/index.ts';

const STATES = ['NSW', 'QLD', 'VIC', 'SA', 'WA', 'TAS', 'ACT', 'NT'].map((state) => ({
  value: state,
  label: state,
}));

export function ControlsDemo() {
  const [state, setState] = useState('NSW');
  const [notify, setNotify] = useState(true);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Select & switch</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="State">
              {(props) => (
                <Select options={STATES} value={state} onValueChange={setState} {...props} />
              )}
            </Field>
            <Field label="Installer" error="Choose an installer before booking.">
              {(props) => (
                <Select
                  options={[
                    { value: 'a', label: 'Bright Electrical' },
                    { value: 'b', label: 'SunFit Installs' },
                  ]}
                  placeholder="Choose installer"
                  {...props}
                />
              )}
            </Field>
            <Field label="Disabled">
              {(props) => <Select options={STATES} defaultValue="QLD" disabled {...props} />}
            </Field>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="notify-switch" className="flex flex-col gap-0.5">
                Email me when a lead is assigned
                <span className="font-normal text-fg-muted">Applies immediately.</span>
              </Label>
              <Switch id="notify-switch" checked={notify} onCheckedChange={setNotify} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="disabled-switch" className="text-fg-muted">
                SMS alerts (no permission)
              </Label>
              <Switch id="disabled-switch" disabled />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Tabs & avatars</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">
                <Info />
                Overview
              </TabsTrigger>
              <TabsTrigger value="system">
                <Wrench />
                System
              </TabsTrigger>
              <TabsTrigger value="files">
                <FileText />
                Files
              </TabsTrigger>
              <TabsTrigger value="history" disabled>
                <History />
                History
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="flex flex-col gap-3">
              {(['Olivia Nguyen', 'Jack Patel', 'Micky'] as const).map((name) => (
                <div key={name} className="flex items-center gap-3 text-sm">
                  <Avatar name={name} />
                  {name}
                </div>
              ))}
            </TabsContent>
            <TabsContent value="system" className="text-sm text-fg-muted">
              10.56 kW solar · 13.5 kWh battery · Sungrow hybrid inverter
            </TabsContent>
            <TabsContent value="files" className="text-sm text-fg-muted">
              No files yet.
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

export function OverlaysDemo() {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Edit contact</Button>
          </DialogTrigger>
          <DialogContent
            title="Edit contact"
            description="Changes are saved to the contact record."
          >
            <DialogBody className="grid gap-4 sm:grid-cols-2">
              <Field label="First name">
                {(props) => <Input defaultValue="Olivia" {...props} />}
              </Field>
              <Field label="Last name">
                {(props) => <Input defaultValue="Nguyen" {...props} />}
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button
                  variant="primary"
                  onClick={() => toast({ title: 'Contact saved', tone: 'success' })}
                >
                  Save
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="danger">
              <Trash2 />
              Delete lead
            </Button>
          </DialogTrigger>
          <DialogContent
            title="Delete this lead?"
            description="Olivia Nguyen and her activity history will be removed. This can't be undone."
            className="max-w-md"
          >
            <DialogFooter className="mt-4">
              <DialogClose asChild>
                <Button variant="ghost">Keep lead</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button
                  variant="danger"
                  onClick={() =>
                    toast({
                      title: 'Could not delete the lead',
                      description: 'This is a demo — nothing was deleted.',
                      tone: 'danger',
                    })
                  }
                >
                  Delete
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Drawer>
          <DrawerTrigger asChild>
            <Button>Open drawer</Button>
          </DrawerTrigger>
          <DrawerContent title="Lead preview" description="Quick look without leaving the list.">
            <div className="flex flex-col gap-3 px-5 py-4 text-sm">
              <div className="flex items-center gap-3">
                <Avatar name="Olivia Nguyen" size="lg" />
                <div>
                  <p className="font-medium">Olivia Nguyen</p>
                  <p className="text-fg-muted">Parramatta NSW · 10.56 kW + battery</p>
                </div>
              </div>
            </div>
          </DrawerContent>
        </Drawer>

        <Button onClick={() => toast({ title: 'Lead assigned to Micky' })}>Show a toast</Button>

        <Tooltip content="3 unread notifications">
          <IconButton label="Notifications" variant="secondary">
            <Bell />
          </IconButton>
        </Tooltip>
        <span className="text-sm text-fg-muted">← hover or focus for a tooltip</span>
      </CardContent>
    </Card>
  );
}
