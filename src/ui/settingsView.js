import { h, mount } from '../utils/dom.js';

export function renderSettingsView(content, app) {
  const { state } = app;
  let newRelay = '';

  const relaysCard = h('section', { class: 'card' }, [
    h('h3', {}, 'Relays'),
    h('p', { class: 'muted' }, 'Sydacalist only talks to the public Nostr relays you configure here. Add community-run relays for redundancy.'),
    h(
      'ul',
      { class: 'relay-list' },
      state.relays.map((url) =>
        h('li', {}, [
          h('span', {}, url),
          h(
            'button',
            {
              class: 'link-btn',
              onClick: () => app.setRelays(state.relays.filter((r) => r !== url)),
            },
            'Remove',
          ),
        ]),
      ),
    ),
    h('div', { class: 'button-row' }, [
      h('input', { type: 'text', placeholder: 'wss://relay.example.com', onInput: (e) => (newRelay = e.target.value) }),
      h(
        'button',
        {
          onClick: () => {
            const url = newRelay.trim();
            if (!url) return;
            if (state.relays.includes(url)) return;
            app.setRelays([...state.relays, url]);
            newRelay = '';
          },
        },
        'Add relay',
      ),
    ]),
  ]);

  const prefsCard = h('section', { class: 'card' }, [
    h('h3', {}, 'Preferences'),
    h('label', { class: 'checkbox-row' }, [
      h('input', {
        type: 'checkbox',
        checked: state.prefs.autoConnect ? '' : undefined,
        onChange: (e) => app.savePrefs({ autoConnect: e.target.checked }),
      }),
      ' Auto-connect to relays on startup',
    ]),
  ]);

  const privacyCard = h('section', { class: 'card' }, [
    h('h3', {}, 'Privacy & security'),
    h('ul', { class: 'privacy-list' }, [
      h('li', {}, '✅ Public: your npub, published notes, likes, reposts, follow list, and any profile metadata you choose to publish.'),
      h(
        'li',
        {},
        "🔒 Private, encrypted at rest: your nsec and your private notes, sealed with your unlock passphrase (AES-GCM + PBKDF2).",
      ),
      h(
        'li',
        {},
        "🏠 Local-only, never transmitted: drafts, relay list, UI preferences, and the local feed cache — all stored in this browser's IndexedDB.",
      ),
      h('li', {}, '🚫 No accounts, no tracking scripts, no analytics, and no central server ever sees your identity or activity.'),
    ]),
  ]);

  const dangerCard = h('section', { class: 'card danger-zone' }, [
    h('h3', {}, 'Danger zone'),
    h(
      'p',
      { class: 'muted' },
      'This permanently wipes every local key, note, draft, and preference from this browser. Make sure you have backed up your nsec if you want to keep this identity.',
    ),
    h(
      'button',
      {
        class: 'danger',
        onClick: async () => {
          if (confirm('Wipe all local Sydacalist data from this browser? This cannot be undone.')) {
            await app.panicWipe();
          }
        },
      },
      '🧨 Panic wipe local data',
    ),
  ]);

  mount(content, relaysCard, prefsCard, privacyCard, dangerCard);
}
