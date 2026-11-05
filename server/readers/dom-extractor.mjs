// Trusted DOM-only script, kept as JavaScript to avoid runtime transpiler helpers in the provider page.
export const capture = ({ provider, mode }) => {
  const visible = (element) =>
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden' &&
    !element.closest('[contenteditable="true"], [role="textbox"], [aria-hidden="true"]');
  const text = (element) =>
    element instanceof HTMLElement ? element.innerText.trim() : element?.textContent?.trim() || '';
  const first = (selectors) => {
    for (const selector of selectors) {
      const node = [...document.querySelectorAll(selector)].find(visible);
      if (node) return node;
    }
    return null;
  };
  const login = [
    ...document.querySelectorAll(
      'input[type="password"], input[name="passwd"], input[type="email"]',
    ),
  ].some((e) => e.getClientRects().length > 0);
  if (login) return { login: true, scope: '', messages: [], truncated: false };
  let scope,
    nodes = [];
  if (provider === 'teams') {
    scope = text(
      first([
        '[data-tid="chat-title"]',
        '[data-tid="chat-title-name-group-chat"]',
        '[data-tid="entity-header"] [role="heading"]',
        '[data-tid="chat-header-title"]',
        '[data-tid="chat-header"] [role="heading"]',
        '[data-tid="channel-header"] [role="heading"]',
        '[data-tid="chat-header"]',
      ]),
    ).slice(0, 300);
    for (const selector of [
      '[data-tid="chat-pane-message"]',
      '[data-message-id]',
      '[data-tid="channel-message"]',
    ]) {
      nodes = [...document.querySelectorAll(selector)].filter(visible);
      if (nodes.length) break;
    }
  } else if (mode === 'LIST') {
    scope =
      text(
        first([
          '[role="treeitem"][aria-selected="true"]',
          '[role="navigation"] [aria-current="page"]',
        ]),
      )
        .replace(/\s+\d+\s*$/, '')
        .slice(0, 300) || 'Rendered mail list';
    nodes = [
      ...document.querySelectorAll(
        '[role="listbox"] [role="option"], [data-app-section="MailList"] [role="option"]',
      ),
    ].filter(visible);
  } else {
    const body = first([
      '[aria-label="Message body"]',
      '[aria-label="Message Body"]',
      '[data-app-section="MailReadCompose"] [role="document"]',
      '[role="main"] [role="document"]',
    ]);
    if (body) nodes = [body];
    scope = text(
      first([
        '[data-app-section="MailReadCompose"] [role="heading"]',
        '[role="main"] h1',
        '[role="main"] [role="heading"][aria-level="2"]',
      ]),
    ).slice(0, 300);
    // Never capture a compose-only panel or its unsent editable contents.
    if (body?.closest('[contenteditable="true"], [role="textbox"]')) nodes = [];
  }
  let total = 0,
    truncated = nodes.length > 50;
  const messages = nodes
    .slice(-50)
    .map((node) => {
      const envelope =
        provider === 'teams' ? node.closest('[data-tid="chat-pane-item"]') || node : node;
      const body =
        provider === 'teams'
          ? node.querySelector(
              '[data-tid="message-body"], [data-tid="message-text"], [data-tid="chat-pane-message-content"]',
            ) || node
          : node;
      const raw = text(body),
        content = raw.slice(0, 6000);
      if (raw.length > content.length) truncated = true;
      total += content.length;
      return {
        sourceId: node.getAttribute('data-message-id') || node.id || '',
        text: content,
        author: text(
          envelope.querySelector('[data-tid="message-author-name"], [data-tid="message-author"]'),
        ).slice(0, 200),
        sentAt:
          envelope.querySelector('time')?.getAttribute('datetime') ||
          envelope.querySelector('[data-tid="timestamp"]')?.getAttribute('title') ||
          envelope.querySelector('time')?.getAttribute('title') ||
          '',
        preview: provider === 'outlook' && mode === 'LIST',
      };
    })
    .filter((m) => m.text && !/^(sign in|sign into your account)$/i.test(m.text));
  while (total > 48000 && messages.length) {
    total -= messages.shift().text.length;
    truncated = true;
  }
  return { login: false, scope, messages, truncated };
};
