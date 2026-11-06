import type { Panel } from '../store';
import { TeamPanel } from './People';
import { ProjectsPanel, Assignment } from './Projects';
import { TeamInbox } from './TeamInbox';
import { MeetingsPanel } from './Meetings';
import { SettingsPanel, BriefingPanel, ActivityPanel } from './Operations';
import { WorkKnowledgePanel } from './WorkKnowledge';
import { ConnectionsPanel } from './AccountConnections';
import { ActionInbox } from './ActionInbox';
import { TimeLogs } from './TimeLogs';
import { StartHere } from './StartHere';
import { MyProjects } from './MyProjects';
export { EmployeePanel } from './People';
export function Panels({ panel }: { panel: Panel }) {
  if (panel === 'start') return <StartHere />;
  if (panel === 'focus') return <MyProjects />;
  if (panel === 'team') return <TeamPanel />;
  if (panel === 'projects') return <ProjectsPanel />;
  if (panel === 'inbox') return <TeamInbox />;
  if (panel === 'notifications') return <ActionInbox />;
  if (panel === 'timelogs') return <TimeLogs />;
  if (panel === 'meetings') return <MeetingsPanel />;
  if (panel === 'settings') return <SettingsPanel />;
  if (panel === 'briefing') return <BriefingPanel />;
  if (panel === 'activity') return <ActivityPanel />;
  if (panel === 'work') return <WorkKnowledgePanel />;
  if (panel === 'connections') return <ConnectionsPanel />;
  if (panel === 'assign')
    return (
      <div className="panel-content">
        <span className="eyebrow">LET’S MAKE SOMETHING GOOD</span>
        <h2>New task</h2>
        <Assignment />
      </div>
    );
  return null;
}
