import { usePortalSignOut } from '../../api/hooks'
import { toast } from '../../app/toasts'
import { Button } from '../../components'
import { SettingRow, SettingsSection } from './layout'

/** The study-portal browser keeps its own sign-ins; this forgets them. */
export function PortalSection(): React.JSX.Element {
  const signOut = usePortalSignOut()
  return (
    <SettingsSection
      title="Study portal"
      description="The portal browser keeps you signed in to Brightspace, Sulis, Blackboard and the like between sessions. Study Buddy never sees your passwords."
    >
      <SettingRow
        label="Sign out of portals"
        description="Forgets every portal sign-in, cookie and saved page data."
      >
        <Button
          loading={signOut.isPending}
          onClick={() =>
            signOut.mutate(
              {},
              { onSuccess: () => toast({ tone: 'ok', title: 'Signed out of every portal' }) }
            )
          }
        >
          Sign out of portals
        </Button>
      </SettingRow>
    </SettingsSection>
  )
}
