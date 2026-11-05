import { useEffect, useState } from 'react';
import type { AccountProvider, AccountView } from '../../shared/connected';
import { api } from '../api';
import { useResource } from './useResource';
import { ErrorText, Submit, useAction, post } from './common';
import { IntegrationsPanel } from './Integrations';
import { BrowserControls } from './BrowserReader';
export function ConnectionsPanel() {
  return (
    <div className="panel-content">
      <h2>Connected accounts</h2>
      <BrowserControls provider="outlook" />
      <BrowserControls provider="teams" />
      <AccountConnections />
      <p className="microcopy">
        Outlook and Teams use dedicated signed-in browser readers with local drafts only. Zoho
        time-log submission still requires approval of each exact entry.
      </p>
      <details>
        <summary>Advanced local-record routing</summary>
        <p className="microcopy">
          These settings apply to the local work registry. Account syncing and approved
          email/time-log actions use the connections above.
        </p>
        <IntegrationsPanel />
      </details>
    </div>
  );
}
export function AccountConnections() {
  const { data, error, refresh } = useResource<{ accounts: AccountView[] }>('/accounts');
  useEffect(() => {
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh]);
  return (
    <section className="account-connections">
      <h3>Connect your accounts</h3>
      <ErrorText error={error} />
      {data?.accounts.map((account) =>
        account.provider === 'outlook' ? (
          <details key={account.provider}>
            <summary>Optional Outlook read-only Graph setup</summary>
            <AccountSetup account={account} refresh={refresh} />
          </details>
        ) : (
          <AccountSetup
            key={account.provider + ':' + account.version + ':' + account.connected}
            account={account}
            refresh={refresh}
          />
        ),
      )}
    </section>
  );
}
function AccountSetup({
  account,
  refresh,
}: {
  account: AccountView;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(!account.configured);
  const [clientId, setClientId] = useState(account.clientId),
    [tenant, setTenant] = useState(account.tenant),
    [region, setRegion] = useState(account.region),
    [secret, setSecret] = useState('');
  const action = useAction(),
    outlook = account.provider === 'outlook';
  const start = async (provider: AccountProvider) => {
    // Reserve a tab synchronously so browser popup rules do not discard the OAuth redirect.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    const result = await action.execute(() =>
      api<{ url: string }>('/accounts/' + provider + '/connect', { method: 'POST', body: '{}' }),
    );
    if (result) {
      if (tab) tab.location.href = result.url;
      else window.location.assign(result.url);
    } else tab?.close();
  };
  return (
    <div className="account-setup">
      <div className="studio-title">
        <h4>{outlook ? 'Microsoft Outlook' : 'Zoho Projects'}</h4>
        <span>{account.connected ? account.account : 'Not connected'}</span>
      </div>
      <p className="microcopy">
        {outlook
          ? 'Sign in with the same Microsoft account you use in Outlook. This app requires its own consent; a PC sign-in is not automatically shared.'
          : 'Connect the same Zoho account used for your manual time logs. Discover your live portals, projects and tasks after sign-in.'}
      </p>
      {!account.connected && account.configured && (
        <button
          className="button primary"
          disabled={action.busy}
          onClick={() => start(account.provider)}
        >
          Sign in to {outlook ? 'Microsoft' : 'Zoho'}
        </button>
      )}
      {account.connected && (
        <button
          className="text-button"
          disabled={action.busy}
          onClick={async () => {
            await action.execute(() => post('/accounts/' + account.provider + '/disconnect', {}));
            await refresh();
          }}
        >
          Disconnect account
        </button>
      )}
      <button className="text-button" onClick={() => setEditing(!editing)}>
        {editing ? 'Hide setup' : 'Connection setup'}
      </button>
      {editing && (
        <>
          <ol className="guide-steps">
            {outlook ? (
              <>
                <li>
                  Open{' '}
                  <a
                    href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Microsoft app registrations
                  </a>{' '}
                  and create an app named “My AI Office”. Your organization may require an
                  administrator.
                </li>
                <li>
                  Add the <strong>Mobile and desktop applications</strong> platform and this exact
                  redirect URL: <code className="copy-value">{account.callbackUrl}</code>
                  <p className="microcopy">
                    Microsoft's portal may reject HTTP 127.0.0.1 in the redirect textbox. In the
                    app's Manifest, add this URL to the public client's redirect URIs instead.{' '}
                    <a
                      href="https://learn.microsoft.com/en-us/entra/identity-platform/reply-url#prefer-127001-over-localhost"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Microsoft's loopback instructions
                    </a>
                  </p>
                </li>
                <li>
                  Add delegated Microsoft Graph permissions <strong>User.Read, Mail.Read</strong>.
                  Copy the Application (client) ID and Directory (tenant) ID below for your work
                  account. No Microsoft client secret is needed.
                </li>
              </>
            ) : (
              <>
                <li>
                  Open the{' '}
                  <a
                    href={'https://api-console.zoho.' + (region === 'ca' ? 'com' : region)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Zoho API console
                  </a>
                  , choose the data center used by your account, and create a{' '}
                  <strong>Server-based application</strong>.
                </li>
                <li>
                  Use homepage <code>http://127.0.0.1:3001</code> and this exact authorized
                  redirect: <code className="copy-value">{account.callbackUrl}</code>
                </li>
                <li>
                  Copy the client ID and secret below. Sign-in requests read access for
                  portals/projects/tasks/issues/users/time logs and permission to create time logs.
                  Creating a draft never submits it.
                </li>
              </>
            )}
          </ol>
          <form
            className="stacked-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await action.execute(
                () =>
                  api('/accounts/' + account.provider, {
                    method: 'PUT',
                    body: JSON.stringify({
                      clientId,
                      tenant,
                      region,
                      version: account.version,
                      ...(secret ? { clientSecret: secret } : {}),
                    }),
                  }),
                'Connection settings saved',
              );
              if (result) {
                setSecret('');
                setEditing(false);
                await refresh();
              }
            }}
          >
            <label>
              Application client ID
              <input
                required
                value={clientId}
                maxLength={200}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
              />
            </label>
            {outlook ? (
              <label>
                Microsoft tenant
                <input
                  value={tenant}
                  onChange={(e) => setTenant(e.target.value)}
                  placeholder="common or your tenant ID"
                />
              </label>
            ) : (
              <>
                <label>
                  Zoho data center
                  <select value={region} onChange={(e) => setRegion(e.target.value)}>
                    {['com', 'eu', 'in', 'com.au', 'jp', 'ca'].map((dc) => (
                      <option key={dc} value={dc}>
                        {dc}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Zoho client secret
                  <input
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    autoComplete="new-password"
                    required={!account.hasClientSecret}
                    placeholder={
                      account.hasClientSecret ? 'Stored securely; leave blank to keep' : ''
                    }
                  />
                </label>
              </>
            )}
            <p className="microcopy">
              Credentials are encrypted locally for this Windows user and never sent to the AI
              runner. Save changes before signing in.
            </p>
            <Submit busy={action.busy}>Save connection settings</Submit>
          </form>
        </>
      )}
      <ErrorText error={action.error} />
    </div>
  );
}
