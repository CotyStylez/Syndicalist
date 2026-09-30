import { h, mount } from '../utils/dom.js';
import { shorten } from '../utils/format.js';
import { renderIdentityView } from './identityView.js';
import { renderFeedView } from './feedView.js';
import { renderProfileView } from './profileView.js';
import { renderNotesView } from './notesView.js';
import { renderWebrtcView } from './webrtcView.js';
import { renderSettingsView } from './settingsView.js';

const TABS = [
  { id: 'identity', label: '🔑 Identity' },
  { id: 'feed', label: '🗞️ Feed' },
  { id: 'profile', label: '🎨 Profile' },
  { id: 'notes', label: '🔒 Private Notes' },
  { id: 'webrtc', label: '📡 Live P2P' },
  { id: 'settings', label: '⚙️ Settings' },
];

export function mountApp(root, app) {
  let activeTab = 'identity';

  function renderShell() {
    const { state } = app;

    const header = h('header', { class: 'app-header' }, [
      h('div', { class: 'brand' }, [
        h('span', { class: 'brand-mark' }, '🛰️'),
        h('span', { class: 'brand-name' }, 'sydacalist'),
      ]),
      h('div', { class: 'identity-pill' }, [
        state.identity
          ? h('span', { class: 'pill pill-unlocked', title: state.identity.npub }, `🟢 ${shorten(state.identity.npub)}`)
          : h('span', { class: 'pill pill-locked' }, state.vaultExists ? '🔒 Locked' : '⚪ No identity yet'),
      ]),
    ]);

    const nav = h(
      'nav',
      { class: 'tabs' },
      TABS.map((tab) =>
        h(
          'button',
          {
            class: `tab-btn${activeTab === tab.id ? ' active' : ''}`,
            onClick: () => {
              activeTab = tab.id;
              renderShell();
            },
          },
          tab.label,
        ),
      ),
    );

    const errorBanner = state.error
      ? h('div', { class: 'error-banner' }, [
          h('span', {}, `⚠️ ${state.error}`),
          h('button', { class: 'link-btn', onClick: () => app.setError(null) }, 'dismiss'),
        ])
      : null;

    const content = h('main', { class: 'content' });
    renderActiveTab(content);

    mount(root, header, nav, errorBanner, content);
  }

  function renderActiveTab(content) {
    switch (activeTab) {
      case 'identity':
        renderIdentityView(content, app);
        break;
      case 'feed':
        renderFeedView(content, app);
        break;
      case 'profile':
        renderProfileView(content, app);
        break;
      case 'notes':
        renderNotesView(content, app);
        break;
      case 'webrtc':
        renderWebrtcView(content, app);
        break;
      case 'settings':
        renderSettingsView(content, app);
        break;
      default:
        break;
    }
  }

  app.subscribe(() => renderShell());
  renderShell();
}
