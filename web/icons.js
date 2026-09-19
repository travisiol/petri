/* inline icons (stroke, currentColor) */
const S = (d, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 1.8}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
window.ICONS = {
  search: S('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  wallet: S('<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><path d="M15 14.5h3"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>', 2),
  copy: S('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
  ext: S('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>'),
  check: S('<path d="M5 12l5 5L20 7"/>', 2.2),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>', 2),
  chevDown: S('<path d="M6 9l6 6 6-6"/>', 2),
  fire: S('<path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.6-2.6 1.4-3.5.2 1.2.9 2 1.6 2.3C11 8 10.6 5.5 12 3z"/>'),
  web: S('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
  xSmall: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 3h3.3l-7.2 8.2L22 21h-6.6l-5.2-6.8L4.3 21H1l7.7-8.8L.6 3h6.8l4.7 6.2L17.5 3zm-1.2 16h1.8L6.4 4.9H4.5L16.3 19z"/></svg>`,
  signin: S('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>'),
  launch: S('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5c.3 4-2 7-6.5 7.2.2-4.6 2.6-7 6.5-7.2z"/><path d="M9.2 15.6l4.6-4.9"/>', 1.6),
  fees: S('<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><path d="M15 14.5h3"/><path d="M8 3l4 3 4-3"/>', 1.6),
  life: S('<path d="M2 12h4l2.5-6 3 12 2.5-8 1.5 2H22"/>', 1.6),
  dish: S('<ellipse cx="12" cy="12" rx="9" ry="6"/><path d="M3 12v2c0 3.3 4 6 9 6s9-2.7 9-6v-2"/><circle cx="9" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="14" cy="13" r="1.5" fill="currentColor" stroke="none"/>', 1.6),
};
