// Read visible My Biologs table cells only. Never click Bundy, submit attendance or read login fields.
export const readAttendance = () => {
  const visible = (el) =>
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  if ([...document.querySelectorAll('input[type="password"],input[type="email"]')].some(visible))
    return { login: true, selfView: false, rows: [] };
  const headings = [
    ...document.querySelectorAll('h1,h2,h3,[role="heading"],.page-title,.page-header'),
  ]
    .filter(visible)
    .map((el) => el.innerText)
    .join(' ');
  const selfView =
    /my\s*bio\s*logs|my\s*attendance/i.test(headings) ||
    /mybiologs|myattendance/i.test(location.pathname);
  if (!selfView) return { login: false, selfView: false, rows: [] };
  const rows = [];
  for (const table of [...document.querySelectorAll('table,[role="grid"]')].filter(visible)) {
    const headers = [...table.querySelectorAll('th,[role="columnheader"]')]
      .filter(visible)
      .map((el) => el.innerText.trim());
    if (!headers.length) continue;
    const group = table.closest('.my-attendance-mainpanel-collapse');
    const groupedDate = group?.innerText.match(
      /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})/i,
    );
    const months = [
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
    ];
    const date = groupedDate
      ? groupedDate[3] +
        '-' +
        String(months.indexOf(groupedDate[1].toLowerCase()) + 1).padStart(2, '0') +
        '-' +
        groupedDate[2].padStart(2, '0')
      : '';
    for (const row of [...table.querySelectorAll('tbody tr,[role="row"]')].filter(visible)) {
      const cells = [...row.querySelectorAll('td,[role="gridcell"]')].map((el) =>
        el.innerText.trim(),
      );
      if (cells.length !== headers.length) continue;
      const values = Object.fromEntries(
        headers
          .map((header, i) => [header, cells[i]])
          .filter(([header]) =>
            /^(date|log date|attendance date|time|log time|in\/out|type|log type|time in|time out|clock in|clock out)$/i.test(
              header,
            ),
          ),
      );
      if (date && !Object.keys(values).some((k) => /date/i.test(k))) values.Date = date;
      rows.push(values);
      if (rows.length >= 400) break;
    }
    if (rows.length >= 400) break;
  }
  return { login: false, selfView, rows };
};
